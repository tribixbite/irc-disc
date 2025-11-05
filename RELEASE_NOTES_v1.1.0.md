# Release Notes: irc-disc v1.1.0

## 🚀 Major Features

### Response-Aware WHOIS Queue
**Prevents "Excess Flood" IRC Kicks**

- Implements event-driven WHOIS queue that waits for server responses (RPL_ENDOFWHOIS)
- Processes one WHOIS request at a time instead of mass flooding
- 5-second timeout fallback prevents queue stalling
- **Fixes:** Bot getting kicked when joining channels with 100+ users

**Before v1.1.0:** Bot sends all WHOIS immediately → IRC server kicks for "Excess Flood"  
**After v1.1.0:** Bot queues WHOIS and waits for each response → No flood kicks

### Strict Configuration Validation with Zod
**Fail-Fast at Startup**

- Comprehensive Zod schema validates entire configuration structure
- Clear, user-friendly error messages for invalid configs
- Prevents runtime crashes from undefined/invalid properties
- **Breaking Change:** Invalid configs now cause startup failure (v1.0.x allowed invalid configs)

### SQLite WAL Mode
**Better Concurrency & Crash Recovery**

- Enables Write-Ahead Logging for improved performance
- Automatic retry on SQLITE_BUSY errors with exponential backoff
- Reduced database corruption risk
- **Note:** Requires specific filesystem support (see README)

## 📝 Breaking Changes

### Configuration Validation (v1.1.0)
Invalid configuration files will now **fail at startup** instead of crashing unpredictably during runtime.

**Migration Guide:**
```bash
# Test your config before upgrading
npx irc-disc@1.1.0 --config config.json

# Fix any validation errors reported
```

### WAL Mode Backups
Database backups now require **all three files**:
- `discord-irc.db`
- `discord-irc.db-wal`
- `discord-irc.db-shm`

See README "Database & Backup" section for details.

## 🐛 Bug Fixes

- Fixed util.log deprecation crash on Node.js 24 (v1.0.4)
- Fixed undefined message template crash during IRC netsplits (v1.0.5)
- Fixed global error handlers for production stability (v1.0.6)

## 📊 Test Results

Tested with v1.0.4 vs v1.1.0 on #tangled (100+ users):

- **v1.0.4:** Kicked for "Excess Flood" after ~7 seconds
- **v1.1.0:** Joins successfully, no flood kicks ✅

## 🔄 Upgrade Instructions

```bash
# Stop the bot
systemctl stop irc-disc

# Update to v1.1.0
npm install -g irc-disc@1.1.0

# Validate configuration
irc-disc --config config.json

# Restart the bot
systemctl start irc-disc
```

## 📚 Documentation Updates

- Added comprehensive database backup guide in README
- Documented WAL mode filesystem requirements
- Added Zod configuration schema reference

## 🙏 Special Thanks

Thanks to Gemini AI for validation and expert guidance on production-ready patterns!

---

**Full Changelog:** https://github.com/tribixbite/irc-disc/compare/v1.0.6...v1.1.0
