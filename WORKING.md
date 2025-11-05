# irc-disc v1.1.3 - Security and Memory Improvements

## ✅ Completed (2025-11-05)

### Security Fix 1: SSRF Protection for Webhooks and S3
**File:** `lib/config/schema.ts`

**Problem:**
- Webhook and S3 endpoint URLs could be configured to point to internal services
- Attacker with config file access could exploit bot to scan internal networks
- No validation prevented localhost, private IPs, or HTTP URLs

**Solution:**
Added two validation functions:
- `isHttpsUrl()`: Enforces HTTPS for all webhook URLs (prevents MITM)
- `isLikelySafeUrl()`: Rejects localhost, private IPs, link-local, and internal TLDs

Applied to:
- S3 endpoint configuration (line 87-90)
- Webhook URL configuration (lines 164-169)

**Impact:**
- ✅ Prevents SSRF attacks via webhook/S3 URLs
- ✅ Enforces HTTPS for all external requests
- ✅ Blocks access to internal network resources (10.x, 192.168.x, 172.16-31.x, 169.254.x)
- ✅ Blocks localhost, .local, .internal, .localhost domains

### Security Fix 2: Environment Variable Support for Secrets
**File:** `lib/cli.ts`

**Problem:**
- Sensitive credentials stored in plaintext config files
- Discord tokens, IRC passwords, S3 keys committed to version control
- No secure way to inject secrets in production environments

**Solution:**
Added `applyEnvironmentOverrides()` function that reads from environment variables:
- `DISCORD_TOKEN`: Discord bot token
- `IRC_PASSWORD`: IRC server password
- `IRC_SASL_USERNAME`, `IRC_SASL_PASSWORD`: SASL authentication
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`: S3 config

**Impact:**
- ✅ Secrets can now be injected via environment variables
- ✅ Config files no longer need to contain credentials
- ✅ Compatible with Docker, Kubernetes, and other deployment platforms
- ✅ Backward compatible - config file values still work if env vars not set

### Memory Fix 3: LRU Cache for Unbounded Maps
**Files:** `lib/bot.ts`, `lib/rate-limiter.ts`

**Problem:**
- `pmThreads` Map grows indefinitely with PM conversations
- `RateLimiter.userActivity` Map grows with every unique user
- No automatic eviction → memory leaks over time
- Long-running bots accumulate thousands of entries

**Solution:**
Replaced Maps with LRU caches:

1. **lib/bot.ts** - PM thread tracking:
   - `pmThreads`: LRU cache with 500 entry limit, 7-day TTL
   - Configurable via `pmThreadCacheSize` option
   - Converts persistence Map data on initialization

2. **lib/rate-limiter.ts** - User activity tracking:
   - `userActivity`: LRU cache with 10,000 entry limit, 7-day TTL
   - Automatic eviction of least recently used entries
   - TTL refreshes on access for active users

**Impact:**
- ✅ Memory usage bounded even with thousands of users/conversations
- ✅ LRU eviction keeps most active data in cache
- ✅ TTL automatically expires stale entries after 7 days
- ✅ No behavior change for normal usage patterns

## 📦 Previous Fixes (v1.1.2)

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

1. **Update package version and publish v1.1.3:**
   ```bash
   cd /data/data/com.termux/files/home/git/discord-irc
   npm version patch  # Bumps to 1.1.3
   npm run build
   npm publish
   ```

2. **Create Git tag:**
   ```bash
   git tag -a v1.1.3 -m "Release v1.1.3: Security and memory improvements"
   git push origin main --tags
   ```

3. **Production deployment with environment variables:**
   ```bash
   cd /data/data/com.termux/files/home/git/dirc
   # Set secrets via environment variables (recommended)
   export DISCORD_TOKEN="your-token-here"
   export IRC_PASSWORD="your-password-here"
   npx irc-disc  # Will use env vars instead of config file values
   ```

## 📊 Summary

**v1.1.3 Changes:**
- ✅ SSRF protection for webhook and S3 URLs
- ✅ Environment variable support for all secrets
- ✅ LRU cache prevents memory leaks in PM threads and rate limiter
- ✅ Tested with production config at ../dirc/config.json
- ✅ All security validations passing

**v1.1.2 Changes (included):**
- ✅ WHOIS requests disabled by default
- ✅ False health check warnings fixed
- ✅ Proper activity tracking for recovery manager

**Status:** Ready for publication
