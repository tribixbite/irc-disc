# irc-disc v1.2.0 - Critical Event Loop Fix & Discord Intents

## ✅ Completed (2025-11-06 to 2025-11-07)

### 🔴 CRITICAL FIX: Event Loop Blocking by IRC Client
**File:** `lib/bot.ts:402-418`

**Problem:**
The bot would connect to Discord successfully and fire the `ready` event, but then **completely stop processing all Discord events** - no messages, no gateway packets, no heartbeats. The Node.js event loop was being blocked by synchronous operations in the IRC client constructor.

**Root Cause:**
The `irc.Client` constructor performs synchronous DNS lookups and network operations, blocking the event loop. This prevented Discord.js from processing incoming WebSocket packets, causing the gateway to go silent after connection.

**Diagnosis:**
Used an event loop "canary" (setInterval that logs every 2 seconds) to detect blocking:
```typescript
setInterval(() => {
  logger.info('[CANARY] Event loop is alive');
}, 2000);
```
Result: Canary never logged after IRC client creation, confirming complete event loop blockage.

**Solution:**
Wrapped IRC initialization in `setImmediate()` to defer it to the next event loop tick:
```typescript
// BEFORE (blocking):
this.ircClient = new irc.Client(this.server, this.nickname, ircOptions);
this.attachIRCListeners();

// AFTER (non-blocking):
setImmediate(() => {
  this.ircClient = new irc.Client(this.server, this.nickname, ircOptions);
  this.ircUserManager = new IRCUserManager(this.ircClient, { enableWhois: false });
  this.attachIRCListeners();
});
```

**Impact:**
- ✅ Event loop now processes Discord.js events correctly
- ✅ MESSAGE_CREATE events fire as expected
- ✅ Gateway heartbeats function properly
- ✅ Bot can receive and relay messages
- ✅ No more "discord has been silent" warnings

**Testing:**
- Standalone test bot (Discord-only) worked perfectly ✅
- Main bot (Discord + IRC) blocked until this fix ✅
- Event loop canary confirms healthy operation ✅

### 🔴 CRITICAL FIX: Missing MESSAGE_CONTENT Intent
**File:** `lib/bot.ts:141-150, 485-494`

**Problem:**
Discord.js v13+ requires the `MESSAGE_CONTENT` privileged intent to access `message.content`. Without it, the bot connects but message content is always empty/undefined.

**Solution:**
Added `Intents.FLAGS.MESSAGE_CONTENT` to Discord client initialization:
```typescript
this.discord = new discord.Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.MESSAGE_CONTENT // Required for message.content access (Discord.js v13+)
  ]
});
```

**IMPORTANT:** You must also enable "Message Content Intent" in Discord Developer Portal:
1. Go to https://discord.com/developers/applications
2. Select your bot application
3. Go to "Bot" tab
4. Under "Privileged Gateway Intents", enable "MESSAGE CONTENT INTENT"
5. Save changes

**Impact:**
- ✅ `message.content` now accessible
- ✅ Messages can be read and relayed
- ✅ Command parsing works

### 🔴 CRITICAL FIX: Missing GUILD_MEMBERS Intent
**File:** `lib/bot.ts:141-150, 485-494`

**Problem:**
Bot could not relay messages because the Discord client was missing the `GUILD_MEMBERS` privileged intent. This caused `guild.members.cache` to be empty, breaking:
- `getDiscordNicknameOnServer()` - couldn't get user nicknames
- `getDiscordAvatar()` - couldn't get user avatars
- Mention detection - couldn't find users to mention
- All code accessing `guild.members.cache` would fail or return undefined

**Root Cause:**
The refactor from JavaScript to TypeScript added many features that access `guild.members.cache`, but the Discord client initialization only included:
- `GUILDS`
- `GUILD_MESSAGES`
- `GUILD_MESSAGE_REACTIONS`

Missing: `GUILD_MEMBERS` (required for member cache)

**Solution:**
Added `Intents.FLAGS.GUILD_MEMBERS` to Discord client initialization:
```typescript
this.discord = new discord.Client({
  retryLimit: 3,
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_MEMBERS // Required for member cache (nicknames, avatars)
  ],
  partials: ['MESSAGE'],
});
```

**IMPORTANT:** You must also enable "Server Members Intent" in Discord Developer Portal:
1. Go to https://discord.com/developers/applications
2. Select your bot application
3. Go to "Bot" tab
4. Under "Privileged Gateway Intents", enable "SERVER MEMBERS INTENT"
5. Save changes

**Impact:**
- ✅ Member cache now populates correctly
- ✅ Nicknames and avatars work
- ✅ Mention detection works
- ✅ Message relaying should now function

### ⚡ PERFORMANCE: Bun Native SQLite Support
**Files:** `lib/persistence-bun.ts` (NEW), `lib/persistence-wrapper.js` (NEW), `lib/persistence-wrapper.d.ts` (NEW)

**Problem:**
- `sqlite3` is a native Node.js module requiring compilation with node-gyp
- Doesn't work with Bun runtime
- Slower than Bun's native SQLite implementation

**Solution:**
Created dual persistence implementation:
1. **persistence-bun.ts**: Uses `Bun.Database` (native, synchronous, fast)
2. **persistence.ts**: Uses `sqlite3` (Node.js, async, requires compilation)
3. **persistence-wrapper.js**: Runtime detection - loads Bun version if `typeof Bun !== 'undefined'`

**Benefits:**
- ✅ **Faster**: Bun's SQLite is synchronous and optimized
- ✅ **No compilation**: Bun.Database is built-in, no node-gyp needed
- ✅ **Drop-in replacement**: Identical API to sqlite3 version
- ✅ **Backward compatible**: Node.js users still use sqlite3
- ✅ **Tested in Termux**: Works perfectly on Android/ARM64

### 🧹 CLEANUP: Removed Bun-Specific Entry Point
**Removed:** `lib/server.ts`

**Problem:**
- `lib/server.ts` had `import { serve } from 'bun'` which crashes in Node.js
- Created confusion about entry points
- Conflicted with `lib/cli.ts`

**Solution:**
- Removed `lib/server.ts` entirely
- Updated `package.json` to use only `lib/cli.ts` as entry point
- Removed `start:server` script

**Impact:**
- ✅ Single entry point: `lib/cli.ts`
- ✅ Works with both Node.js and Bun
- ✅ No more import crashes

---

# irc-disc v1.1.5 - Join Message Spam Fix

## ✅ Completed (2025-11-05)

### 🔴 CRITICAL FIX: StatusNotificationManager Spamming Join Messages
**File:** `lib/bot.ts:293-303`

**Problem:**
Bot was spamming IRC join messages to Discord continuously due to StatusNotificationManager being enabled by default. This feature was **NOT in the original discord-irc** and was added in our fork.

**Root Cause:**
1. StatusNotificationManager defaults to `enabled: true` (lib/status-notifications.ts:34)
2. `useDedicatedChannels: true` by default (line 35)
3. `fallbackToMainChannel: true` by default (line 36)
4. **No dedicated channel configured**, so ALWAYS falls back to main channel
5. Every IRC join event triggered a Discord message via fallback channel
6. Original implementation only sent join messages if `ircStatusNotices` was enabled
7. Our fork ignored this and always sent via StatusNotificationManager

**Comparison with Original:**
```javascript
// ORIGINAL (discord-irc-original/lib/bot.js:198-206)
this.ircClient.on('join', (channelName, nick) => {
  if (!this.ircStatusNotices) return;  // ✅ Early exit if disabled
  if (nick === this.ircClient.nick && !this.announceSelfJoin) return;
  this.sendExactToDiscord(channel, `*${nick}* has joined the channel`);
});

// OUR FORK (lib/bot.ts:786-801) - BROKEN
const sent = await this.statusNotifications.sendJoinNotification(...);
// StatusNotificationManager ALWAYS sends because fallbackToMainChannel=true!
```

**Solution:**
Disabled StatusNotificationManager by default to match original behavior:
```typescript
const finalStatusConfig: Partial<typeof statusConfig> & { enabled: boolean } = {
  ...statusConfig,
  enabled: (options.statusNotifications as any)?.enabled ?? false  // Default: disabled
};
this.statusNotifications = new StatusNotificationManager(finalStatusConfig);
```

**Impact:**
- ✅ Join message spam stopped
- ✅ Behavior now matches original discord-irc
- ✅ StatusNotificationManager can still be explicitly enabled via config
- ✅ Legacy `ircStatusNotices` option works correctly

---

# irc-disc v1.1.4 - Critical Message Routing Fix

## ✅ Completed (2025-11-05)

### 🔴 CRITICAL FIX: Message Routing Failure
**File:** `lib/bot.ts`

**Problem:**
ALL message routing was completely broken. Messages were not being relayed between Discord and IRC due to unhandled promise rejections:
- Discord → IRC: `sendToIRC(message)` called without `.catch()`
- IRC → Discord: `sendToDiscord()` bound without error handling
- 8 event handlers marked with "TODO: almost certainly not async safe"
- All errors silently swallowed, no logging, messages dropped

**Root Cause:**
Async functions called in event handlers without error handling:
```typescript
// BROKEN - No error handling
this.discord.on('messageCreate', (message) => {
  this.sendToIRC(message);  // Unhandled promise rejection!
});

this.ircClient.on('message', this.sendToDiscord.bind(this));  // Errors swallowed!
```

**Solution:**
Added proper error handling to ALL async event handlers:

1. **Discord messageCreate** (line 647):
   ```typescript
   this.sendToIRC(message).catch((error) => {
     logger.error('Error sending Discord message to IRC:', error);
   });
   ```

2. **IRC message handler** (line 713):
   ```typescript
   this.ircClient.on('message', (author, channel, text) => {
     this.sendToDiscord(author, channel, text).catch((error) => {
       logger.error('Error sending IRC message to Discord:', error);
     });
   });
   ```

3. **IRC notice handler** (line 725)
4. **IRC nick change** (line 732) - wrapped in async IIFE
5. **IRC join** (line 767) - wrapped in async IIFE
6. **IRC part** (line 809) - wrapped in async IIFE
7. **IRC quit** (line 861) - wrapped in async IIFE
8. **IRC action** (line 920)

**Impact:**
- ✅ Messages NOW ACTUALLY WORK between Discord ↔ IRC
- ✅ Errors now logged instead of silently failing
- ✅ Fixed 8 async-unsafe event handlers
- ✅ Removed all "TODO: almost certainly not async safe" comments

## 📦 Previous Release (v1.1.3)

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
