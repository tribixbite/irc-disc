# Message Synchronization Race Condition Analysis

**Date:** 2025-11-11
**Version:** 1.2.1
**File:** lib/message-sync.ts

---

## Executive Summary

**Status:** ⚠️ POTENTIAL RACE CONDITIONS IDENTIFIED

The MessageSynchronizer has **3 potential race conditions** that could cause message edit/delete notifications to fail or behave incorrectly under timing-sensitive scenarios:

1. **Critical:** Message sent → immediately edited before recordMessage() completes
2. **Critical:** Message sent → immediately deleted before recordMessage() completes
3. **Medium:** IRC disconnects between readyState check and say() call

---

## Architecture Overview

The MessageSynchronizer tracks Discord→IRC messages in an in-memory Map for 5 minutes to enable edit/delete notifications:

```typescript
Flow:
1. Discord message sent → Bot sends to IRC → recordMessage() saves to Map
2. Discord message edited → handleMessageEdit() looks up in Map → sends [EDIT] to IRC
3. Discord message deleted → handleMessageDelete() looks up in Map → sends [DELETED] to IRC
```

**Key State:**
- `messageHistory: Map<string, MessageRecord>` - In-memory message tracking
- `editWindow: 5 minutes` - Time window for edit/delete notifications
- `maxHistorySize: 1000` - Memory limit

---

## Race Condition #1: Message Send → Immediate Edit (CRITICAL)

### Description
If a Discord user sends a message and immediately edits it (within milliseconds), the edit event may arrive **before** `recordMessage()` has been called.

### Code Locations
- `recordMessage()` at line 26 - synchronous, but called from async flow
- `handleMessageEdit()` at line 48-68 - looks up message in Map

### Scenario
```
Timeline:
T0: User sends Discord message "Hello"
T1: Discord messageCreate event fires
T2: Bot.sendToDiscord() processes message
T3: User edits message to "Hello world" (VERY FAST USER)
T4: Discord messageUpdate event fires
T5: handleMessageEdit() looks up message in Map → NOT FOUND ❌
T6: recordMessage() finally called, adds message to Map
```

### Impact
- **Severity:** Medium
- **Frequency:** Rare (requires sub-second edit timing)
- **Effect:** Edit notification silently dropped, IRC users see "Hello" but not "Hello world"

### Current Behavior
```typescript
// lib/message-sync.ts:68-72
const messageRecord = this.messageHistory.get(fullMessage.id);
if (!messageRecord) {
  logger.debug(`No record found for edited message ${fullMessage.id}`);
  return; // ❌ Silently drops the edit
}
```

### Recommended Fix
**Option A: Queue edits if message not yet recorded**
```typescript
private pendingEdits: Map<string, Array<{oldMsg, newMsg}>> = new Map();

async handleMessageEdit(oldMessage, newMessage): Promise<void> {
  const messageRecord = this.messageHistory.get(fullMessage.id);

  if (!messageRecord) {
    // Queue the edit for later processing
    if (!this.pendingEdits.has(fullMessage.id)) {
      this.pendingEdits.set(fullMessage.id, []);
    }
    this.pendingEdits.get(fullMessage.id)!.push({oldMessage, newMessage});

    // Retry after short delay
    setTimeout(() => this.retryPendingEdit(fullMessage.id), 100);
    return;
  }

  // Process edit normally
}

recordMessage(discordMessageId, ...): void {
  this.messageHistory.set(discordMessageId, record);

  // Process any pending edits
  const pending = this.pendingEdits.get(discordMessageId);
  if (pending) {
    for (const {oldMsg, newMsg} of pending) {
      this.handleMessageEdit(oldMsg, newMsg);
    }
    this.pendingEdits.delete(discordMessageId);
  }
}
```

**Option B: Accept the race (document limitation)**
- Document that edits within ~100ms of sending may be dropped
- Add metric to track how often this happens
- Most users don't edit that fast

---

## Race Condition #2: Message Send → Immediate Delete (CRITICAL)

### Description
Same as Race #1, but for message deletion. User deletes message before `recordMessage()` is called.

### Code Locations
- `handleMessageDelete()` at line 120-128

### Scenario
```
Timeline:
T0: User sends Discord message "Oops wrong channel"
T1: Discord messageCreate event fires
T2: User immediately deletes message (panic delete)
T3: Discord messageDelete event fires
T4: handleMessageDelete() looks up message in Map → NOT FOUND ❌
T5: recordMessage() called (too late)
```

### Impact
- **Severity:** Medium
- **Frequency:** Rare (requires very fast delete)
- **Effect:** Delete notification not sent to IRC, IRC users see "ghost message"

### Current Behavior
```typescript
// lib/message-sync.ts:124-128
const messageRecord = this.messageHistory.get(message.id);
if (!messageRecord) {
  logger.debug(`No record found for deleted message ${message.id}`);
  return; // ❌ Silently ignores the delete
}
```

### Recommended Fix
Same as Race #1 - either queue pending deletes or accept the limitation.

---

## Race Condition #3: IRC Disconnect During Send (MEDIUM)

### Description
Between checking `ircClient.readyState === 'open'` and calling `ircClient.say()`, the IRC connection could drop.

### Code Locations
- `handleMessageEdit()` line 98-100
- `handleMessageDelete()` line 142-144
- `handleBulkDelete()` line 191-193

### Scenario
```
Timeline:
T0: User edits Discord message
T1: handleMessageEdit() checks ircClient.readyState → 'open' ✅
T2: IRC connection drops (network error, server restart, etc.)
T3: ircClient.say() called → THROWS ERROR ❌
```

### Impact
- **Severity:** Low
- **Frequency:** Very rare (requires precise timing with network failure)
- **Effect:** Error logged, edit/delete notification lost

### Current Behavior
```typescript
// lib/message-sync.ts:98-100
if (this.bot.ircClient && this.bot.ircClient.readyState === 'open') {
  this.bot.ircClient.say(messageRecord.ircChannel, editNotification); // ❌ Could throw
  // ...
}
```

### Recommended Fix
**Wrap in try-catch:**
```typescript
if (this.bot.ircClient && this.bot.ircClient.readyState === 'open') {
  try {
    this.bot.ircClient.say(messageRecord.ircChannel, editNotification);
    logger.info(`Sent edit notification to ${messageRecord.ircChannel}`);
    this.bot.metrics.recordEdit();
  } catch (error) {
    logger.warn(`Failed to send edit notification (IRC may have disconnected):`, error);
    // Could potentially queue for retry when IRC reconnects
  }

  // Update record regardless of send success
  messageRecord.ircMessage = formattedContent;
  messageRecord.timestamp = Date.now();
}
```

---

## Race Condition #4: Concurrent Fetch During Edit (INFORMATIONAL)

### Description
While `await newMessage.fetch()` is executing (line 59), the message could be deleted or edited again.

### Code Location
- `handleMessageEdit()` lines 56-66

### Scenario
```
Timeline:
T0: User edits message (edit #1)
T1: handleMessageEdit() called for edit #1
T2: Message is partial, await newMessage.fetch() starts
T3: User edits message again (edit #2)
T4: handleMessageEdit() called for edit #2 (runs in parallel)
T5: Edit #1 fetch completes, processes with old content
T6: Edit #2 processes with new content
Result: Both edits sent to IRC (may confuse users)
```

### Impact
- **Severity:** Very Low
- **Frequency:** Extremely rare
- **Effect:** Duplicate edit notifications, slightly confusing but not breaking

### Current Behavior
Both edits would be sent to IRC. The messageRecord would be updated twice (last write wins).

### Recommended Fix
Not worth fixing - acceptable behavior. Could add timestamp check after fetch if needed.

---

## Race Condition #5: Concurrent edits updating same record (INFORMATIONAL)

### Description
Two concurrent edits could both mutate `messageRecord` at lines 106-107.

### Impact
**Not actually a race condition** - JavaScript is single-threaded, so mutations are atomic. Last edit wins, which is acceptable.

---

## Additional Observations

### ✅ Safe Patterns (No Race Conditions)

1. **Map iteration + deletion:**
   ```typescript
   // lib/message-sync.ts:209-213
   for (const [messageId, record] of this.messageHistory.entries()) {
     if (record.timestamp < cutoffTime) {
       this.messageHistory.delete(messageId); // ✅ Safe in JavaScript
     }
   }
   ```
   JavaScript Maps are safe to modify while iterating.

2. **Synchronous recordMessage():**
   ```typescript
   recordMessage(discordMessageId, ...): void {
     this.messageHistory.set(discordMessageId, record); // ✅ Synchronous, atomic
   }
   ```

3. **Edit window check:**
   ```typescript
   const timeSinceOriginal = Date.now() - messageRecord.timestamp;
   if (timeSinceOriginal > this.editWindow) {
     return; // ✅ No TOCTOU issue, single read
   }
   ```

### ⚠️ Missing Error Handling

1. **bot.parseText() could throw** (line 82) - should wrap in try-catch
2. **ircClient.say() could throw** (lines 99, 143, 192) - should wrap in try-catch

---

## Recommendations

### Priority 1: Add try-catch around IRC send operations
**Status:** Quick win (15 minutes)

Wrap all `ircClient.say()` calls in try-catch to prevent unhandled errors when IRC disconnects mid-operation.

### Priority 2: Document edit/delete race condition
**Status:** Quick win (5 minutes)

Add comment documenting that edits/deletes within ~100ms of sending may be dropped. This is acceptable given the rarity.

### Priority 3: Add metrics for dropped edit/delete notifications
**Status:** Medium effort (30 minutes)

Track how often edits/deletes are dropped due to race conditions:
```typescript
this.bot.metrics.recordDroppedEdit();
this.bot.metrics.recordDroppedDelete();
```

### Priority 4 (Optional): Implement pending edit/delete queue
**Status:** High effort (2-3 hours)

Only if metrics show this is a common problem. Adds significant complexity for minimal benefit.

---

## Conclusion

**Overall Assessment:** ⚠️ LOW RISK

The MessageSynchronizer has theoretical race conditions, but:
- **Frequency:** Very rare (requires sub-second timing)
- **Impact:** Low (edit/delete notifications dropped, not data loss)
- **Workaround:** Users can resend messages if needed

**Recommended Action:**
1. ✅ Add try-catch around IRC send operations (Priority 1)
2. ✅ Document the limitation (Priority 2)
3. ⏳ Consider metrics if issue reports come in (Priority 3)
4. ❌ Don't implement pending queue unless proven necessary (Priority 4)

The code is **production-ready** with minor hardening improvements recommended.
