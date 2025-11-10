# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- GUILD_MEMBERS intent for improved member tracking
- Bun native SQLite support for better performance
- SQLite WAL (Write-Ahead Logging) mode for improved concurrency

### Fixed
- StatusNotificationManager now disabled by default to prevent join message spam

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
