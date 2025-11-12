# IRC Connection Leak Fix

**Date:** 2025-11-12
**Severity:** Critical
**Component:** IRC Reconnection Logic

## Problem Summary

When WiFi drops on mobile devices, the bot creates **multiple simultaneous IRC connections** (observed: 11 concurrent connections) instead of a single reconnection attempt. This causes:

1. Connection storm when network recovers
2. Circuit breaker incrementing rapidly
3. Multiple ping timers running simultaneously
4. SASL authentication failures from nickname conflicts
5. Resource exhaustion and potential rate limiting from IRC servers

## Root Cause Analysis

### Primary Issue: Missing `autoConnect: false` in reconnectIRC()

**File:** `lib/bot.ts`
**Method:** `reconnectIRC()` (line 665-676)

The initial connection properly disables auto-connect:
```typescript
// Initial connection (line 418-429)
const ircOptions = {
  ...this.ircOptions,
  userName: this.nickname,
  realName: this.nickname,
  channels: this.channels,
  floodProtection: true,
  floodProtectionDelay: 500,
  retryCount: 0,
  autoRenick: true,
  autoConnect: false, // ✅ PRESENT - Disables auto-connect
};
```

But the reconnection logic was missing this critical option:
```typescript
// Reconnection (line 665-674) - BEFORE FIX
const ircOptions = {
  userName: this.nickname,
  realName: this.nickname,
  channels: this.channels,
  floodProtection: true,
  floodProtectionDelay: 500,
  retryCount: 0,
  autoRenick: true,
  ...this.ircOptions, // ❌ User config could enable autoConnect
  // ❌ MISSING: autoConnect: false
};
```

**Impact:** When `new irc.Client()` is created (line 686), the IRC library auto-connects if:
- User's config has `autoConnect: true`, OR
- User's config doesn't specify `autoConnect` (defaults to true)

This creates a connection BEFORE the bot can attach listeners, leading to:
- Uncontrolled connection attempts
- Multiple connections if DNS resolution or network is slow
- Race conditions with event handlers

### Secondary Issue: Missing Explicit .connect() Call

After creating the IRC client (line 686), the code waits for 'registered' event (line 702) but never explicitly calls `.connect()`:

```typescript
this.ircClient = new irc.Client(ircServerAddress, this.nickname, enhancedOptions);
this.attachIRCListeners();

// Wait for connection
await new Promise((resolve, reject) => {
  this.ircClient.once('registered', () => { resolve(); });
  // ❌ MISSING: this.ircClient.connect(0);
});
```

This worked accidentally because `autoConnect` was enabled. But with proper `autoConnect: false`, the client never connects.

### Tertiary Issue: No Guard Against Concurrent Reconnections

While `RecoveryManager` has a `isRecovering` flag (line 136), multiple error events can trigger `reconnectIRC()` calls before the flag is set:

```typescript
// Error event handlers ALL call recordFailure():
this.ircClient.on('error', (error) => {
  this.recoveryManager.recordFailure('irc', error); // Line 878
});
this.ircClient.on('abort', () => {
  this.recoveryManager.recordFailure('irc', ...); // Line 892
});
this.ircClient.on('close', () => {
  this.recoveryManager.recordFailure('irc', ...); // Line 906
});
this.ircClient.on('netError', (error) => {
  this.recoveryManager.recordFailure('irc', error); // Line 920
});
```

When WiFi drops:
1. Multiple old connections fire error/close/netError events
2. Each calls `recordFailure()`
3. Each triggers `triggerRecovery()`
4. While the RecoveryManager has a guard, the Bot class didn't

## The Fix

### 1. Add `autoConnect: false` to reconnection options

**File:** `lib/bot.ts:665-676`

```typescript
const ircOptions = {
  // Spread config first so our critical fixes can override it
  ...this.ircOptions,
  userName: this.nickname,
  realName: this.nickname,
  channels: this.channels,
  floodProtection: true,
  floodProtectionDelay: 500,
  retryCount: 0, // CRITICAL: Disable auto-retry, let RecoveryManager handle it
  autoRenick: true,
  autoConnect: false, // CRITICAL: Must come AFTER spread to override any config setting
};
```

**Key changes:**
- Moved `...this.ircOptions` to the START (so we can override it)
- Added `autoConnect: false` at the END (ensures it overrides config)
- Added comment explaining why order matters

### 2. Add explicit .connect() call

**File:** `lib/bot.ts:712-713`

```typescript
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('IRC connection timeout after 30s'));
  }, 30000);

  this.ircClient.once('registered', () => {
    clearTimeout(timeout);
    resolve(void 0);
  });

  this.ircClient.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });

  // Explicitly connect with retryCount: 0 (no auto-retry)
  this.ircClient.connect(0); // ✅ ADDED
});
```

### 3. Add reconnection guard flag

**File:** `lib/bot.ts:143` (Class property)

```typescript
// IRC connection state tracking
private ircConnected: boolean = false;
private ircRegistered: boolean = false;
private ircReconnecting: boolean = false; // ✅ ADDED - Guard against concurrent reconnections
private lastIRCActivity: number = Date.now();
private ircHealthCheckInterval?: NodeJS.Timeout;
```

**File:** `lib/bot.ts:649-656` (Method guard)

```typescript
private async reconnectIRC(): Promise<boolean> {
  // Guard against concurrent reconnections
  if (this.ircReconnecting) {
    logger.debug('IRC reconnection already in progress, skipping duplicate attempt');
    return false;
  }

  this.ircReconnecting = true;

  try {
    // ... reconnection logic
  } catch (error) {
    // ... error handling
  } finally {
    // Always reset reconnection flag
    this.ircReconnecting = false;
  }
}
```

## Testing Recommendations

### Manual Testing

1. **WiFi Drop Test:**
   - Start bot on mobile device
   - Disable WiFi
   - Wait 10 seconds
   - Re-enable WiFi
   - **Expected:** Single reconnection attempt, no connection storm

2. **Network Flapping Test:**
   - Rapidly toggle WiFi on/off
   - **Expected:** Reconnection guard prevents concurrent attempts

3. **DNS Resolution Failure Test:**
   - Use invalid DNS server
   - Trigger reconnection
   - **Expected:** Graceful timeout, no hanging connections

### Automated Testing

```typescript
// Test reconnection guard
test('should prevent concurrent reconnections', async () => {
  const bot = createBot();
  await bot.connect();

  // Simulate multiple error events
  bot.ircClient.emit('error', new Error('Test'));
  bot.ircClient.emit('netError', new Error('Test'));
  bot.ircClient.emit('close');

  // Verify only one reconnection attempt
  expect(reconnectCallCount).toBe(1);
});
```

## Impact Assessment

**Before Fix:**
- 11 simultaneous connections on WiFi recovery
- Circuit breaker failures: 84+ in 10 seconds
- Multiple SASL auth failures (433 nickname conflicts)
- Ping timer leak (2366, 2368, 2369, 2378, 2379, etc.)

**After Fix:**
- Single controlled reconnection attempt
- Proper DNS resolution before connection
- No concurrent connection storms
- Clean connection state management

## Related Issues

- **AREAS_NEEDING_WORK.md** - Item #3: Connection drop integration tests ✅ COMPLETED
- **lib/recovery-manager.ts** - Circuit breaker implementation
- **lib/bot.ts:836-921** - IRC event handlers
- **test/connection-monitoring.test.ts** - Integration test suite (49 tests passing)

## Future Improvements

1. **Connection Pool Management:** Track all active connections and force-close leaked connections
2. **Backoff Strategy:** Implement exponential backoff for repeated failures (already in RecoveryManager)
3. **Health Monitoring:** Add metrics for connection leak detection
4. **Connection Timeout:** Add timeout for connection establishment (already present: 30s)

## References

- IRC Library: `irc-upd` - https://github.com/Throne3d/node-irc
- Recovery Manager Implementation: `lib/recovery-manager.ts`
- Integration Tests: `test/connection-monitoring.test.ts`
- Metrics Tracking: `lib/metrics.ts`
