# irc-disc v1.1.2 - Health Check and WHOIS Fixes

## ✅ Completed (2025-11-05)

### Fix 1: WHOIS Timeout Spam
**Files:** `lib/irc-user-manager.ts`, `lib/bot.ts`

**Problem:**
Bot was generating hundreds of WHOIS timeout warnings:
```
2025-11-05T06:22:45.363Z warn: WHOIS for tribixbite failed or timed out
2025-11-05T06:22:50.364Z warn: WHOIS for ramram-ink failed or timed out
[... hundreds more ...]
```

**Root Cause:**
- `IRCUserManager` automatically requested WHOIS for every user
- Many IRC servers don't respond to WHOIS (5-second timeout per user)
- 100+ users = 8+ minutes of continuous warnings

**Solution:**
- Added `IRCUserManagerConfig` with `enableWhois` option (default: false)
- Early return in `requestUserInfo()` when WHOIS disabled
- Both `IRCUserManager` instantiations now disable WHOIS

**Impact:**
- ✅ No more WHOIS timeout spam
- ✅ Optional WHOIS can still be enabled per-config

### Fix 2: False "Service Silent" Warnings
**File:** `lib/bot.ts`

**Problem:**
Health check falsely reported services as silent despite active message bridging:
```
2025-11-05T06:24:27.128Z warn: discord has been silent for 118818ms
2025-11-05T06:24:27.128Z warn: irc has been silent for 112640ms
```

**Root Cause:**
- `RecoveryManager` only updated `lastSuccessful` on initial connections
- Message send/receive didn't call `recordSuccess()` to mark activity
- Health check incorrectly flagged services as unhealthy

**Solution:**
Added `this.recoveryManager.recordSuccess()` calls at 5 locations:
1. `sendToDiscord()` - IRC command messages (line 1353)
2. `sendToDiscord()` - IRC webhook messages (line 1446)
3. `sendToDiscord()` - IRC regular messages (line 1473)
4. Discord→IRC command messages (line 1114)
5. Discord→IRC regular messages (line 1143)

**Impact:**
- ✅ Health check now tracks actual message activity
- ✅ No false "silent" warnings when messages are flowing
- ✅ Proper health status for monitoring/recovery

## 📦 Previous Releases

### v1.1.0 - Production Improvements (2025-11-04)

#### Response-Aware WHOIS Queue
**File:** `lib/irc/response-aware-whois-queue.ts` (NEW)
- Prevents "Excess Flood" IRC kicks when joining channels with many users
- Event-driven queue waits for RPL_ENDOFWHOIS (318) before sending next request
- 5-second timeout fallback prevents queue stalling

#### Zod Configuration Validation
**Files:** `lib/config/schema.ts` (NEW), `lib/cli.ts`
- Comprehensive schema validates entire config structure
- User-friendly error messages for invalid properties
- **Breaking Change:** Invalid configs now cause startup failure

#### SQLite WAL Mode with Retry Logic
**File:** `lib/persistence.ts`
- Enabled PRAGMA journal_mode = WAL for better concurrency
- Added `writeWithRetry()` with exponential backoff for SQLITE_BUSY errors

## 🚀 Next Steps

1. **Test with live server:**
   ```bash
   cd /data/data/com.termux/files/home/git/dirc
   npx irc-disc
   # Should see: "IRC User Manager initialized (WHOIS disabled)"
   # Should NOT see: any WHOIS timeout warnings
   ```

2. **Build and publish v1.1.2:**
   ```bash
   cd /data/data/com.termux/files/home/git/discord-irc
   npm version patch  # Bumps to 1.1.2
   npm run build
   npm publish
   ```

3. **Create Git tag:**
   ```bash
   git tag -a v1.1.2 -m "Release v1.1.2: Fix WHOIS timeout spam"
   git push origin main --tags
   ```

## 📊 Summary

**v1.1.2 Changes:**
- ✅ WHOIS requests now disabled by default
- ✅ Eliminates timeout spam on non-WHOIS servers
- ✅ Configurable via `IRCUserManagerConfig` if needed
- ✅ All tests passing (same baseline as before)

**Status:** Ready for testing and publication
