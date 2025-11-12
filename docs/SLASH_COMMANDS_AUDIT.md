# Slash Commands Documentation Audit

**Date:** 2025-11-12
**Auditor:** Claude Code

## Summary

**Total Commands:** 16
**Documented in README.md:** 7
**Missing from README.md:** 9
**All commands require:** Administrator permissions

## Commands Comparison

| Command Name | Documented in README | Description | Notes |
|-------------|---------------------|-------------|-------|
| `/irc-status` | ✅ Yes (line 284) | Show IRC bridge status and statistics | Complete |
| `/irc-users` | ✅ Yes (line 292) | List users in IRC channels | Complete with subcommands |
| `/irc-channels` | ✅ Yes (line 299) | Discover and manage IRC channels | Complete with subcommands |
| `/irc-command` | ✅ Yes (line 308) | Execute IRC commands with safety controls | Complete with subcommands |
| `/irc-who` | ✅ Yes (line 313) | Execute WHO command to find IRC users | Complete |
| `/irc-lists` | ✅ Yes (line 319) | View channel access control lists | Complete with subcommands |
| `/irc-recovery` | ✅ Yes (line 327) | Monitor and control error recovery systems | Complete with subcommands |
| `/irc-pm` | ❌ **Missing** | Manage IRC private message threads | **Needs documentation** |
| `/irc-reconnect` | ❌ **Missing** | Force IRC client to reconnect | **Needs documentation** |
| `/irc-ratelimit` | ❌ **Missing** | Manage IRC bridge rate limiting | **Needs documentation** |
| `/irc-metrics` | ❌ **Missing** | View detailed IRC bridge metrics and statistics | **Needs documentation** |
| `/irc-s3` | ❌ **Missing** | Manage S3 file upload settings | **Needs documentation** |
| `/irc-mentions` | ❌ **Missing** | Manage IRC-to-Discord mention notifications | **Needs documentation** |
| `/irc-status-notifications` | ❌ **Missing** | Manage IRC status notifications (join/leave/timeout) | **Needs documentation** |
| `/irc-userinfo` | ❌ **Missing** | Get detailed information about IRC users | May overlap with `/irc-users lookup` |
| `/irc-channelinfo` | ❌ **Missing** | Get detailed information about IRC channels | May overlap with `/irc-channels info` |

## Analysis

### Overlap Investigation

**`/irc-userinfo` vs `/irc-users lookup`:**
- Both commands exist as separate slash commands
- `/irc-userinfo` may be a standalone version
- `/irc-users lookup` is a subcommand under `/irc-users`
- **Recommendation:** Document both, clarify relationship

**`/irc-channelinfo` vs `/irc-channels info`:**
- Both commands exist as separate slash commands
- `/irc-channelinfo` may be a standalone version
- `/irc-channels info` is a subcommand under `/irc-channels`
- **Recommendation:** Document both, clarify relationship

### Commands Needing Documentation

All 9 missing commands should be documented in README.md:

1. **`/irc-pm`** - Important for PM thread management
2. **`/irc-reconnect`** - Critical for connection recovery
3. **`/irc-ratelimit`** - Important for rate limit management
4. **`/irc-metrics`** - Essential for monitoring
5. **`/irc-s3`** - Configuration command
6. **`/irc-mentions`** - Feature configuration
7. **`/irc-status-notifications`** - Feature configuration
8. **`/irc-userinfo`** - User lookup tool
9. **`/irc-channelinfo`** - Channel information tool

### Recommended README.md Structure

```markdown
## 🎮 Discord Commands

### 📊 **Administrative Commands**

#### Status & Monitoring
- `/irc-status` - Bridge status and statistics
- `/irc-metrics` - Detailed metrics and statistics
- `/irc-recovery` - Error recovery and health monitoring

#### Connection Management
- `/irc-reconnect` - Force IRC reconnection

#### User & Channel Discovery
- `/irc-users [subcommand]` - Manage and view IRC user information
- `/irc-userinfo` - Get detailed information about IRC users
- `/irc-channels [subcommand]` - Discover and manage IRC channels
- `/irc-channelinfo` - Get detailed information about IRC channels
- `/irc-who <pattern>` - Advanced user search

#### Moderation & Commands
- `/irc-command [subcommand]` - Execute IRC commands with safety controls
- `/irc-lists [subcommand]` - View channel access control lists

#### Configuration & Features
- `/irc-pm` - Manage IRC private message threads
- `/irc-ratelimit` - Manage rate limiting
- `/irc-s3` - Manage S3 file upload settings
- `/irc-mentions` - Manage mention notifications
- `/irc-status-notifications` - Manage status notifications
```

## Action Items

- [ ] Add documentation for `/irc-pm` in README.md
- [ ] Add documentation for `/irc-reconnect` in README.md
- [ ] Add documentation for `/irc-ratelimit` in README.md
- [ ] Add documentation for `/irc-metrics` in README.md
- [ ] Add documentation for `/irc-s3` in README.md
- [ ] Add documentation for `/irc-mentions` in README.md
- [ ] Add documentation for `/irc-status-notifications` in README.md
- [ ] Add documentation for `/irc-userinfo` in README.md
- [ ] Add documentation for `/irc-channelinfo` in README.md
- [ ] Reorganize README.md commands section with better categorization
- [ ] Clarify relationship between standalone commands and subcommands
