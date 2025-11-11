# Areas Needing Work

Analysis of irc-disc codebase identifying areas that need improvement or fixing.

**Date:** 2025-11-11
**Current Version:** 1.2.1

---

## 🔴 High Priority

### 1. ✅ COMPLETED - Other Slash Commands Need IRC Connection Protection

**Issue:** Only `/irc-channels` has IRC connection checks and timeout protection. Other commands that use IRC are vulnerable to the same issues.

**Affected Commands:**
- ✅ `/irc-users lookup` - Added connection check at lib/slash-commands.ts:1488
- ✅ `/irc-users search` - Added connection check at lib/slash-commands.ts:1488
- ✅ `/irc-users stats` - Added connection check at lib/slash-commands.ts:1488
- ✅ `/irc-channel-info` - Added connection check at lib/slash-commands.ts:1754
- ✅ `/irc-who <pattern>` - Added connection check + 30s timeout at lib/slash-commands.ts:1981,1996
- ✅ `/irc-command send` - Added connection check at lib/slash-commands.ts:2164

**Solution Implemented:**
```typescript
// Added to each IRC-dependent command:
if (!bot.isIRCConnected()) {
  await interaction.reply({
    content: '❌ IRC Not Connected',
    ephemeral: true
  });
  return;
}

// Added timeout for /irc-who:
const result = await Promise.race([
  bot.ircUserManager.whoQuery(pattern),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
]);
```

**Completed:** 2025-11-11 - All IRC-dependent slash commands now protected

---

### 2. Recovery Manager May Not Properly Reconnect IRC

**Issue:** The `RecoveryManager` tracks failures but unclear if it properly triggers IRC reconnection.

**Files:** `lib/recovery-manager.ts`, `lib/bot.ts`

**Investigation Needed:**
- Does recovery manager actually call `bot.ircClient.connect()` on IRC failure?
- What's the retry backoff strategy?
- Does it respect the new `ircConnected` state?
- Does it work with the new health monitoring?

**Testing:**
```bash
# Simulate IRC disconnect
# Kill IRC server or block connection
# Watch logs to see if recovery triggers
```

---

### 3. No Integration Tests for Connection Drop Scenarios

**Issue:** Tests exist but don't cover:
- IRC connection drop during operation
- Slash command execution during IRC downtime
- Health monitoring behavior
- Recovery manager triggering reconnection

**Needed Tests:**
```typescript
describe('IRC Connection Drop', () => {
  it('should detect connection drop within 60 seconds');
  it('should reject slash commands when IRC is down');
  it('should timeout long-running IRC operations');
  it('should trigger recovery manager on connection loss');
  it('should update connection state on all IRC events');
});
```

**Files:** Need new test file `test/connection-monitoring.test.ts`

---

## 🟡 Medium Priority

### 4. Message Synchronization May Have Race Conditions

**Issue:** `MessageSynchronizer` tracks Discord↔IRC message mapping for edits/deletes, but may have race conditions.

**Files:** `lib/message-sync.ts`

**Potential Issues:**
- Edit/delete happening before original message is saved
- Concurrent edits on same message
- Message mapping cleanup doesn't account for failed sends

**Investigation:** Review message-sync.ts for race conditions

---

### 5. Rate Limiter Doesn't Account for IRC Connection State

**Issue:** Rate limiter may still enforce limits when IRC is down, causing legitimate messages to be dropped unnecessarily.

**Files:** `lib/rate-limiter.ts`

**Suggestion:**
```typescript
// In rate limiter check:
if (!bot.isIRCConnected()) {
  // Don't enforce rate limits when IRC is down
  // Messages won't be sent anyway
  return true; // Allow
}
```

---

### 6. Status Notifications Don't Reflect IRC Health

**Issue:** `StatusNotificationManager` sends join/leave notifications but doesn't notify on IRC connection drops.

**Files:** `lib/status-notifications.ts`

**Enhancement:**
```typescript
// On IRC disconnect:
statusNotifications.sendNotification(
  '❌ IRC connection lost - attempting reconnection...'
);

// On IRC reconnect:
statusNotifications.sendNotification(
  '✅ IRC connection restored'
);
```

---

### 7. Webhook URLs in Config May Expire

**Issue:** Discord webhook URLs contain tokens that can be regenerated/invalidated by server admins.

**Files:** `lib/bot.ts:400-410`

**Current Behavior:** Bot crashes on invalid webhook URL

**Better Behavior:**
- Detect invalid webhook (401/404 errors)
- Log warning but continue operating
- Fall back to regular bot messages
- Notify admin via status channel

---

## 🟢 Low Priority

### 8. No Prometheus Metrics for IRC Connection Health

**Issue:** Metrics server exports message counts but not IRC connection state.

**Files:** `lib/metrics-server.ts`, `lib/metrics.ts`

**Enhancement:**
```typescript
// Add metrics:
irc_connected{status="connected|disconnected"}
irc_last_activity_seconds
irc_connection_uptime_seconds
irc_reconnection_count
```

---

### 9. Config Schema Doesn't Validate Webhook URLs

**Issue:** Zod schema accepts any string for webhook URLs, doesn't validate format.

**Files:** `lib/config/schema.ts`

**Enhancement:**
```typescript
webhooks: z.record(
  z.string(),
  z.string().url().regex(/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/)
).optional()
```

---

### 10. No Graceful Shutdown on SIGTERM/SIGINT

**Issue:** Bot may not cleanly save state on shutdown.

**Files:** `lib/cli.ts`, `lib/bot.ts`

**Enhancement:**
```typescript
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await bot.disconnect();
  process.exit(0);
});
```

---

### 11. S3 Upload Failures Don't Have Fallback

**Issue:** If S3 upload fails, attachment is lost. No fallback to Discord CDN or local storage.

**Files:** `lib/s3-uploader.ts`

**Enhancement:**
- Log S3 failure but don't block message
- Include original Discord CDN URL as fallback
- Or upload to Discord file storage as backup

---

### 12. PM Thread Auto-Archive Time Not Configurable Per-Thread

**Issue:** All PM threads use same auto-archive time from config.

**Files:** `lib/bot.ts` (PM functionality)

**Enhancement:** Allow per-user override or dynamic adjustment based on activity

---

### 13. No Rate Limiting on Slash Commands

**Issue:** Admin can spam `/irc-who` or `/irc-channels list` causing IRC server floods.

**Enhancement:**
- Add per-user cooldown on IRC-heavy commands
- Limit to 1 request per 10 seconds per user
- Or use Discord's built-in cooldown feature

---

### 14. IRC Nick Color Palette Not Well Documented

**Issue:** `ircNickColors` config option exists but unclear how to use it or what format.

**Files:** `lib/bot.ts`, README.md

**Enhancement:** Add documentation with examples

---

### 15. Database Cleanup May Be Too Aggressive

**Issue:** `persistence.cleanup()` deletes PM threads inactive >7 days, channel users >1 day.

**Files:** `lib/persistence.ts:353-378`, `lib/persistence-bun.ts` (missing cleanup!)

**Concerns:**
- 7 days may be too short for infrequent PM users
- Channel users cleanup every 1 day seems very aggressive
- **Bun persistence missing cleanup() implementation entirely**

**Fix Needed:**
```typescript
// lib/persistence-bun.ts - ADD MISSING METHOD:
async cleanup(): Promise<void> {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

  this.db.run('DELETE FROM pm_threads WHERE last_activity < ?', [sevenDaysAgo]);
  this.db.run('DELETE FROM channel_users WHERE last_updated < ?', [oneDayAgo]);
}
```

---

## 📊 Summary

**Total Issues Identified:** 15

**By Priority:**
- 🔴 High: 3 (IRC command protection, recovery manager, integration tests)
- 🟡 Medium: 4 (race conditions, rate limiter, status notifications, webhook handling)
- 🟢 Low: 8 (metrics, validation, graceful shutdown, minor enhancements)

**Most Critical:**
1. ✅ Add IRC connection checks to all IRC-dependent slash commands
2. ✅ Add timeout protection to `/irc-who` command
3. ✅ Fix missing `cleanup()` in Bun persistence implementation
4. Test and verify recovery manager actually reconnects IRC

**Quick Wins:**
- ✅ Add `cleanup()` to persistence-bun.ts (15 min)
- ✅ Add SIGTERM/SIGINT handlers (15 min)
- Add IRC health metrics to Prometheus (30 min)

---

## Next Steps

**Recommended Order:**
1. ✅ **DONE** - Add IRC connection monitoring
2. ✅ **DONE** - Add timeout protection to `/irc-channels list`
3. ✅ **DONE** - Add same protections to other IRC commands (`/irc-who`, `/irc-users`, etc.)
4. ✅ **DONE** - Fix missing `cleanup()` in persistence-bun.ts
5. ✅ **DONE** - Fix DNS reconnection loop (8000+ failures)
6. ✅ **DONE** - Add graceful shutdown handlers
7. 🔴 Write integration tests for connection drop scenarios
8. 🟡 Test recovery manager reconnection
9. 🟡 Add connection status notifications
10. 🟢 Add IRC health Prometheus metrics

**Estimated Time to Address High Priority:** 4-6 hours
**Estimated Time to Address All Issues:** 12-16 hours
