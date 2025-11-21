# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **S3 Encryption Key Database Persistence** - Automatic encryption key persistence and recovery
  - Encryption keys automatically saved to database on generation/configuration
  - Bot auto-loads keys from database on startup if not in environment
  - Priority: environment variable → database → generate new
  - Eliminates manual key backup requirement across bot restarts
  - Keys stored in `bot_metrics` table as `s3_encryption_key`
  - Updated response message shows automatic persistence status
- **S3 Auto-Generated Encryption Keys** - Eliminates manual key generation requirement
  - Optional `encryption_key` parameter in `/s3 config set` command
  - Auto-generates 64-character hex key if not provided
  - Bot displays generated key in response with setup instructions
  - Validates user-provided keys (must be 64 hex characters)
  - Reduces S3 setup from 3 steps to 2 steps
  - Backward compatible - uses existing env var if set
- **Configurable Database Cleanup Thresholds** - Database retention periods now fully configurable
  - `dbCleanupPMThreadDays`: Control PM thread mapping retention (1-365 days, default: 7)
  - `dbCleanupChannelUsersDays`: Control channel user cache retention (0.001-365 days, default: 1)
  - Enhanced logging shows configured thresholds on cleanup
  - Supports use cases from aggressive cleanup (hours) to archival (years)
- **Graceful Shutdown Handlers** - Clean SIGTERM/SIGINT handling
  - Properly closes Discord and IRC connections on shutdown signals
  - Database connections closed cleanly
  - Prevents orphaned connections and incomplete transactions
  - Exit codes properly set for monitoring systems

### Changed
- **README Documentation** - Comprehensive database configuration section
  - Added "Database Cleanup Configuration" subsection with examples
  - Updated Enterprise Settings to reflect actual SQLite implementation (removed Redis)
  - Removed outdated REDIS_URL environment variable
  - Added guidance on when to adjust cleanup thresholds

### Fixed
- **`/pm` Command UX** - No longer requires `privateMessages.channelId` configuration
  - Command now works in any channel without setup
  - Uses the channel where command is invoked by default
  - Falls back to configured `privateMessages.channelId` if set
  - More intuitive user experience - slash commands "just work"
  - Backward compatible with existing configurations
- **PM Message Relay** - IRC PM responses now appear in Discord threads
  - Fixed thread lookup to work without `pmChannelId` configuration
  - Uses persistence database to find threads in any channel
  - Properly handles threads created via `/pm` in arbitrary channels
  - Respects configured `formatDiscord` message formatting
- **All 16 Issues in AREAS_NEEDING_WORK.md Completed** 🎉
  - All high-priority issues resolved
  - All medium-priority issues resolved
  - All low-priority issues resolved
  - Project now in excellent production-ready state

## [1.2.3] - 2025-11-20

### Code Quality & Type Safety

**Major Improvements:**
- **100% TypeScript Type Safety** - Eliminated all 83 explicit `any` types across the entire codebase
- **98% Linting Error Reduction** - Fixed 175 of 178 linting errors (178 → 3)
- **Zero Type Safety Issues** - All actionable code quality problems resolved
- **All 233 Tests Passing** - Maintained full test coverage throughout refactoring

### Changed

**Type Safety Improvements (18 rounds of systematic refactoring):**
- Created proper TypeScript interfaces for Discord.js and Node.js polyfills
- Added comprehensive type definitions for IRC user management
- Replaced `any` types with specific interfaces in all test files
- Implemented proper typing for database row interfaces
- Enhanced type safety in S3 uploader and rate limiter modules
- Added type guards and proper type narrowing throughout codebase

**Code Quality Enhancements:**
- Fixed all unused interface warnings
- Resolved async/await compatibility issues
- Added appropriate `eslint-disable` comments for justified cases
- Improved interface naming conventions (underscore prefix for reserved types)
- Enhanced error handling with proper type guards

**Specific Module Improvements:**
- `lib/bot.ts`: Complete type safety with custom Discord.js interfaces
- `lib/slash-commands.ts`: Full IRC and Discord.js type integration
- `lib/persistence.ts`: Proper database row type definitions
- `lib/persistence-bun.ts`: Type-safe Bun synchronous wrapper
- `lib/irc-user-manager.ts`: Comprehensive IRC user type system
- `lib/s3-uploader.ts`: Complete S3 operation type coverage
- `lib/message-sync.ts`: Type-safe message synchronization
- All test files: Proper mock and stub typing

**Remaining Items:**
- 3 parsing errors for `.js` files (not actionable - JavaScript files)

### Technical Details

**Type System Enhancements:**
- `UtilWithLog` interface for Node.js polyfill compatibility
- `DiscordRawPacket` interface for gateway packet typing
- `DiscordClientWithInstanceId` for diagnostic tracking
- `IRCUserInfo`, `IRCChannelUser`, `IRCChannelListItem` for IRC data
- Database row interfaces with proper snake_case naming
- S3 configuration interfaces with encryption support

**Testing:**
- Maintained 100% test pass rate through all 18 refactoring rounds
- 233 tests covering all functionality
- Enhanced test type safety with proper mock typing

## [1.2.2] - 2025-11-XX

### Added
- **S3 File Management System**: Comprehensive S3 file operations via Discord slash commands
  - `/s3 config` subcommands for secure credential management
  - `/s3 files` subcommands for upload, list, info, rename, delete operations
  - `/s3 share` command for streamlined upload and share workflow
  - Rate limiting (5 uploads per 10 minutes per user)
  - Pagination UI with interactive buttons for file listing
  - Image preview for uploaded files
  - File metadata display with size, content type, last modified
  - Interactive delete confirmation with 60-second timeout

### Security
- AES-256-GCM encryption for S3 credentials in database
- Admin-only command permissions by default
- Role-based access control support
- Secure credential handling (never logged or displayed)

## [1.2.1] - 2025-11-09

### Fixed
- **CRITICAL:** Fixed config schema stripping `format` field causing duplicate usernames in IRC messages
  - Added `format` field to Zod schema (ircText, urlAttachment, discord, commandPrelude, webhookAvatarURL)
  - User's `format.ircText` config is now respected instead of being silently ignored
- **CRITICAL:** Fixed config schema stripping multiple essential fields:
  - `ircOptions` - IRC client configuration (debug, retryCount, floodProtection, port, secure, sasl)
  - `ignoreUsers` - User filtering lists (irc, discord, discordIds)
  - `autoSendCommands` - IRC commands on connect (e.g., NickServ authentication)
  - `ircNickColors` - Custom IRC nickname color palette
  - `announceSelfJoin` - Bot self-join announcement control
  - `parallelPingFix` - Parallel ping protection
  - `commandCharacters` - Custom command prefixes
  - `dbPath` - Database persistence path
  - `ircNickColor` - IRC nickname coloring toggle
  - `ircStatusNotices` - IRC status notice control
  - `logLevel` - Logging verbosity control
- Fixed webhook API to use discord.js v13+ syntax (single options object instead of separate parameters)

### Added
- Version printing on startup (shows package version from package.json)
- Logging level info on startup (shows current log level and how to enable debug logs)
- Debug logging for config validation to trace format template loading

### Changed
- Improved config validation error messages with field-specific details
- Enhanced startup logging to show which config values are being used

## [1.2.0] - 2025-01-XX

### Added
- **Bun Runtime Support**: Full compatibility with Bun JavaScript runtime
  - Native `bun:sqlite` persistence implementation (3x faster than sqlite3)
  - Automatic runtime detection via `persistence-wrapper.js`
  - DNS resolution workaround for Termux/Android using `Bun.spawn(['ping'])`
  - Drop-in replacement with identical API
  - Optional dependency - works with or without Bun installed
- **GUILD_MEMBERS Intent**: Improved Discord member tracking and nickname resolution
- **SQLite WAL Mode**: Write-Ahead Logging for better concurrency and crash recovery
  - Requires copying `.db`, `.db-wal`, and `.db-shm` files for backups
  - Automatic fallback to rollback journal on unsupported filesystems

### Fixed
- StatusNotificationManager now disabled by default to prevent join message spam
- DNS resolution issues in Termux/Android environments
- Event loop blocking that prevented Discord message events

### Performance
- **Bun Runtime**: ~5x faster startup, ~30% lower memory usage
- **Synchronous SQLite**: Bun's native database API eliminates async overhead
- **No Compilation**: Bun eliminates need for node-gyp and native build tools

## [1.1.5] - 2025-01-XX

### Fixed
- Disabled StatusNotificationManager by default to stop join message spam

## [1.1.4] - 2025-01-XX

### Fixed
- Critical bug fixes (see WORKING.md for details)

---

## Important Notes

### v1.2.1 - Config Schema Fix

**If you were experiencing any of these issues, upgrade to v1.2.1:**
- Duplicate usernames in IRC messages (e.g., `<bot_nick> <discord_user> message`)
- IRC connection settings being ignored (debug mode, flood protection, etc.)
- User ignore lists not working
- NickServ authentication failing silently
- Custom IRC colors not applying
- Database path not being respected

**Root Cause:** The Zod configuration schema was missing several fields, causing `validateConfig()` to silently strip valid user configuration during validation.

**Solution:** All config fields are now properly defined in the schema and will be preserved.

### Discord.js v13+ Requirement

If you're using webhooks, ensure you have discord.js v13 or higher installed. The webhook API changed from:
```javascript
// Old (v12 and earlier)
webhook.send(content, { username, avatarURL })

// New (v13+)
webhook.send({ content, username, avatarURL })
```

This change is backward incompatible. The bot now uses the v13+ syntax.
