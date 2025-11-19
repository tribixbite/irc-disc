# Additional Connection Storm and Error Handling Risks

**Date:** 2025-11-12
**Analysis:** Comprehensive review of potential connection storms, loops, and unhandled errors

## Executive Summary

Beyond the critical `autoConnect: false` bug we just fixed, there are **4 additional high-severity issues** that could cause connection storms, resource leaks, and cascading failures:

1. 🔴 **CRITICAL:** Event listener duplication on reconnection (IRC + Discord)
2. 🔴 **CRITICAL:** Timer leak - IRC cleanup interval created on every reconnection
3. 🟠 **HIGH:** Unhandled promise rejections in async event handlers
4. 🟡 **MEDIUM:** Event loop canary interval never cleared

---

## 🔴 Issue #1: Event Listener Duplication (CRITICAL)

### Problem

Both `attachIRCListeners()` and `attachDiscordListeners()` are called on **every reconnection** without removing old listeners first. This causes **exponential listener growth**.

### Code Locations

**IRC Reconnection (lib/bot.ts:703):**
```typescript
private async reconnectIRC(): Promise<boolean> {
  // ...
  this.ircClient = new irc.Client(ircServerAddress, this.nickname, enhancedOptions);

  // Re-attach IRC listeners
  this.attachIRCListeners(); // ❌ NO removeAllListeners() before this!

  // ...
}
```

**Discord Reconnection (lib/bot.ts:613):**
```typescript
private async reconnectDiscord(): Promise<boolean> {
  // ...
  this.discord = new discord.Client({ /* ... */ });

  // Re-attach Discord listeners
  this.attachDiscordListeners(); // ❌ NO removeAllListeners() before this!

  // ...
}
```

### Impact

**After 1st reconnection:** 2x listeners
**After 2nd reconnection:** 3x listeners
**After 3rd reconnection:** 4x listeners
**After 10 reconnections:** 11x listeners 🔥

This means:
- Each IRC message triggers 11 handlers
- Each Discord message triggers 11 handlers
- 11x memory usage for listener closures
- 11x duplicate messages sent
- Massive performance degradation

### Reproduction

1. Start bot
2. Trigger IRC disconnect (turn off WiFi)
3. Turn WiFi back on → bot reconnects → **2x listeners**
4. Repeat 10 times → **11x listeners** per event

### Fix Required

**Before reconnecting, remove old listeners:**

```typescript
// lib/bot.ts:reconnectIRC()
private async reconnectIRC(): Promise<boolean> {
  try {
    // ...

    // ✅ FIX: Remove old listeners before creating new client
    if (this.ircClient) {
      this.ircClient.removeAllListeners();
    }

    this.ircClient = new irc.Client(ircServerAddress, this.nickname, enhancedOptions);
    this.attachIRCListeners();

    // ...
  }
}

// lib/bot.ts:reconnectDiscord()
private async reconnectDiscord(): Promise<boolean> {
  try {
    // ...

    // ✅ FIX: Remove old listeners before creating new client
    if (this.discord) {
      this.discord.removeAllListeners();
    }

    this.discord = new discord.Client({ /* ... */ });
    this.attachDiscordListeners();

    // ...
  }
}
```

---

## 🔴 Issue #2: Timer Leak - IRC Cleanup Interval (CRITICAL)

### Problem

The IRC cleanup interval is created **inside the 'registered' event handler**, which fires on **every successful connection**. This creates a **new 6-hour interval on every reconnection** without clearing the old one.

### Code Location

**lib/bot.ts:877-880:**
```typescript
this.ircClient.on('registered', (message) => {
  logger.info('✅ Connected and registered to IRC');
  // ... other code ...

  // Schedule periodic cleanup of IRC user data (every 6 hours)
  setInterval(() => { // ❌ LEAK: New interval on every 'registered' event!
    this.ircUserManager.cleanup();
  }, 6 * 60 * 60 * 1000);
});
```

### Impact

**After 1st connection:** 1 interval
**After 2nd reconnection:** 2 intervals running in parallel
**After 10 reconnections:** 10 intervals running in parallel 🔥

Each interval:
- Runs `ircUserManager.cleanup()` every 6 hours
- Performs database queries
- Never gets garbage collected (leak)

After 100 reconnections → **100 timers** → cleanup runs 100 times every 6 hours

### Fix Required

**Move interval creation outside event handler:**

```typescript
// lib/bot.ts:853 (inside attachIRCListeners)
this.ircClient.on('registered', (message) => {
  logger.info('✅ Connected and registered to IRC');
  // ... existing code ...

  // ✅ FIX: Start cleanup interval only if not already running
  if (!this.ircCleanupInterval) {
    this.ircCleanupInterval = setInterval(() => {
      this.ircUserManager.cleanup();
    }, 6 * 60 * 60 * 1000);
  }
});

// Add class property (line ~145):
private ircCleanupInterval?: NodeJS.Timeout;

// Clear in disconnect() (line ~509):
if (this.ircCleanupInterval) {
  clearInterval(this.ircCleanupInterval);
  this.ircCleanupInterval = undefined;
}
```

---

## 🟠 Issue #3: Unhandled Promise Rejections in Async Event Handlers (HIGH)

### Problem

Multiple async event handlers have **no try/catch blocks** or `.catch()` handlers. If these throw errors, they become **unhandled promise rejections** which can crash Node.js in strict mode.

### Code Locations

**Discord async handlers without try/catch:**

```typescript
// lib/bot.ts:753 - No try/catch
this.discord.on('ready', async () => {
  logger.info('Connected to Discord');
  // ... async operations that could throw
});

// lib/bot.ts:810 - No try/catch
this.discord.on('messageUpdate', async (oldMessage, newMessage) => {
  await this.messageSync.handleMessageEdit(oldMessage, newMessage); // Could throw!
});

// lib/bot.ts:814 - No try/catch
this.discord.on('messageDelete', async (message) => {
  await this.messageSync.handleMessageDelete(message); // Could throw!
});

// lib/bot.ts:818 - No try/catch
this.discord.on('messageDeleteBulk', async (messages) => {
  await this.messageSync.handleBulkDelete(messages); // Could throw!
});
```

**IRC async handlers without try/catch:**

```typescript
// lib/bot.ts:948 - No try/catch
this.ircClient.on('pm', async (from, text) => {
  await this.handleIrcPrivateMessage(from, text); // Could throw!
});
```

### Impact

If any of these async operations throw:
- Unhandled promise rejection
- Error logged to console but handler stops
- In strict mode (Node 15+), process may exit
- Silent failures (message lost, no retry)

### Fix Required

**Wrap all async event handlers in try/catch:**

```typescript
// ✅ FIX: Wrap async Discord handlers
this.discord.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    await this.messageSync.handleMessageEdit(oldMessage, newMessage);
  } catch (error) {
    logger.error('Error handling message edit:', error);
    this.metrics.recordError();
  }
});

this.discord.on('messageDelete', async (message) => {
  try {
    await this.messageSync.handleMessageDelete(message);
  } catch (error) {
    logger.error('Error handling message delete:', error);
    this.metrics.recordError();
  }
});

// ... same for all other async handlers
```

---

## 🟡 Issue #4: Event Loop Canary Interval Never Cleared (MEDIUM)

### Problem

The event loop canary interval logs every 2 seconds but is **never cleared**, even when bot disconnects. While this doesn't cause a critical issue, it's a minor resource leak.

### Code Location

**lib/bot.ts:397-399:**
```typescript
setInterval(() => {
  logger.info('[CANARY] Event loop is alive');
}, 2000); // ❌ Return value not stored, can't be cleared
```

### Impact

- Minor log spam (every 2 seconds forever)
- Small memory leak (1 timer + closure)
- Not critical but poor practice

### Fix Required

**Store interval reference and clear on disconnect:**

```typescript
// Store the interval (line ~397)
this.eventLoopCanary = setInterval(() => {
  logger.info('[CANARY] Event loop is alive');
}, 2000);

// Add class property (line ~145):
private eventLoopCanary?: NodeJS.Timeout;

// Clear in disconnect() (line ~509):
if (this.eventLoopCanary) {
  clearInterval(this.eventLoopCanary);
  this.eventLoopCanary = undefined;
}
```

---

## 📊 Risk Assessment

| Issue | Severity | Likelihood | Impact | Priority |
|-------|----------|------------|--------|----------|
| Event listener duplication | 🔴 Critical | High | Connection storm, memory leak, duplicate messages | **P0** |
| Timer leak (cleanup interval) | 🔴 Critical | High | Memory leak, excessive DB queries | **P0** |
| Unhandled promise rejections | 🟠 High | Medium | Process crash, silent failures | **P1** |
| Event loop canary leak | 🟡 Medium | Low | Minor resource waste | **P2** |

---

## 🧪 Testing Recommendations

### Test 1: Listener Duplication
```bash
# Start bot, then repeatedly disconnect/reconnect IRC
# Monitor: Should see only 1 message per IRC event, not 2x, 3x, etc.
```

### Test 2: Timer Leak
```bash
# Add logging to ircUserManager.cleanup()
# Reconnect IRC 10 times
# Wait 6 hours
# Expected: cleanup() called 1 time
# Bug behavior: cleanup() called 10 times
```

### Test 3: Promise Rejection
```bash
# Inject error into messageSync.handleMessageEdit()
# Edit a Discord message
# Expected: Error logged but bot continues
# Bug behavior: Unhandled rejection, possible crash
```

---

## 🔧 Recommended Fix Priority

**Phase 1 (Immediate - P0):**
1. Add `removeAllListeners()` before reconnection (Issue #1)
2. Fix IRC cleanup interval leak (Issue #2)

**Phase 2 (Short-term - P1):**
3. Add try/catch to all async event handlers (Issue #3)

**Phase 3 (Optional - P2):**
4. Fix event loop canary leak (Issue #4)

---

## 📝 Summary

The original `autoConnect: false` bug we fixed was the **trigger** for connection storms. But these **4 additional issues** are **multipliers** that make each reconnection progressively worse:

**1st reconnection:**
- 1 autoConnect bug = 1 connection ✅ FIXED
- But: 2x listeners, 2x cleanup timers

**10th reconnection:**
- 1 autoConnect bug = 1 connection ✅ FIXED
- But: 11x listeners, 11x cleanup timers
- Each IRC message triggers 11 handlers
- 11 cleanup operations every 6 hours

**Combined effect without these fixes:**
- WiFi drops → autoConnect creates 11 connections
- Each connection → adds more listeners + timers
- Result: **121x multiplier** on message handling
- Plus: 121 cleanup timers running

With the `autoConnect: false` fix we just applied, we eliminated the **connection storm trigger**. But we still need to fix the **listener duplication** and **timer leaks** to prevent resource exhaustion on repeated reconnections.

---

## 🎯 Next Steps

1. **Immediate:** Apply Issue #1 and #2 fixes (listener duplication + timer leak)
2. **Test:** Run bot through 10 reconnection cycles
3. **Verify:** Check listener count and timer count stay at 1
4. **Phase 2:** Add try/catch to async handlers
5. **Phase 3:** Clean up event loop canary

---

## References

- Original connection leak fix: `docs/IRC_CONNECTION_LEAK_FIX.md`
- Bot implementation: `lib/bot.ts`
- Recovery manager: `lib/recovery-manager.ts`
- Event emitter docs: https://nodejs.org/api/events.html#emitterremovealllistenersname
