# 🌉 irc-disc Bridge

<div align="center">

[![npm version](https://badge.fury.io/js/irc-disc.svg)](https://www.npmjs.com/package/irc-disc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A powerful, feature-rich bridge connecting Discord and IRC with enterprise-grade reliability**

*Seamlessly synchronize messages, manage channels, and maintain full IRC feature parity within Discord*

[🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) • [⚙️ Configuration](#️-configuration) • [🎯 Features](#-features) • [📋 Changelog](CHANGELOG.md) • [🛠️ Contributing](#️-contributing)

</div>

---

## 🔔 What's New in v1.2.1

**Critical Bug Fixes:**
- Fixed config schema stripping essential fields (format, ircOptions, ignoreUsers, etc.)
- Fixed duplicate usernames in IRC messages when using custom `format.ircText`
- Updated webhook API to discord.js v13+ syntax

**Improvements:**
- Version and log level printed on startup
- Enhanced config validation with detailed error messages

[📋 See full changelog](CHANGELOG.md)

---

## ✨ Features at a Glance

### 🔗 **Core Bridging**
- **Bidirectional messaging** between Discord and IRC channels
- **Real-time synchronization** with message edit/delete support
- **Rich media handling** with S3-compatible attachment storage
- **Webhook integration** for enhanced Discord formatting
- **Private message bridging** with threaded conversations

### 🎛️ **IRC Feature Parity**
- **Complete user tracking** with IP addresses and connection details
- **Channel discovery** with powerful search and filtering
- **Dynamic channel management** - join/leave channels on demand
- **Full moderation suite** - kick, ban, topic management, channel modes
- **Raw IRC command execution** for advanced administration
- **WHO/WHOIS queries** with pattern-based network search
- **Ban/quiet/exception list viewing**

### 🛡️ **Enterprise Features**
- **Advanced rate limiting** with spam detection and auto-moderation
- **Comprehensive monitoring** with Prometheus metrics
- **Graceful error recovery** with automatic reconnection
- **Persistent state management** with configurable backends
- **Status notifications** with dedicated channels
- **Mention detection** with anti-self-ping protection

### 🎨 **User Experience**
- **Rich Discord slash commands** for all IRC operations
- **Interactive embeds** with formatted channel and user information
- **Admin-only controls** with granular permission management
- **Real-time feedback** with progress indicators and error handling
- **Comprehensive logging** with configurable levels

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **Discord Bot Token** - [Get one here](https://discord.com/developers/applications)
- **IRC Server Access** - Any IRC network (Libera.Chat, OFTC, etc.)

### Installation

```bash
# Install via npm
npm install -g irc-disc

# Or clone and build from source
git clone https://github.com/tribixbite/irc-disc.git
cd irc-disc
npm install
npm run build
```

### Basic Setup

1. **Create a bot configuration file:**

```json
{
  "nickname": "DiscordBot",
  "server": "irc.libera.chat",
  "discordToken": "YOUR_DISCORD_BOT_TOKEN",
  "channelMapping": {
    "DISCORD_CHANNEL_ID": "#irc-channel"
  }
}
```

2. **Start the bridge:**

```bash
# Using global installation
irc-disc --config config.json

# Or from source
npm start -- --config config.json
```

3. **Verify connection:**
   - Check Discord for successful bot login
   - Verify IRC connection in server logs
   - Test message synchronization

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/irc-disc)

---

## 📖 Documentation

### 🎯 Core Concepts

#### Channel Mapping
The bridge connects Discord channels to IRC channels through a flexible mapping system:

```json
{
  "channelMapping": {
    "123456789012345678": "#general",     // Discord channel ID to IRC channel
    "#announcements": "#announcements",    // Discord channel name (with #)
    "987654321098765432": "#dev +secret"  // IRC channel with key
  }
}
```

#### Message Synchronization
- **Discord → IRC**: Messages are formatted for IRC compatibility
- **IRC → Discord**: Messages support rich formatting and mentions
- **Bidirectional edits**: Edit messages in either platform
- **Deletion sync**: Delete messages with configurable time windows

#### User Management
The bridge maintains comprehensive user information:
- Real-time IRC user tracking with WHOIS data
- Channel membership and operator status
- Connection details including IP addresses
- Away status and idle time monitoring

---

## ⚙️ Configuration

### 📋 Complete Configuration Reference

<details>
<summary><strong>📂 Core Settings</strong></summary>

```json
{
  "nickname": "DiscordBot",
  "server": "irc.libera.chat",
  "port": 6697,
  "secure": true,
  "password": "optional_server_password",
  "discordToken": "YOUR_DISCORD_BOT_TOKEN",
  "channelMapping": {
    "DISCORD_CHANNEL_ID": "#irc-channel"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `nickname` | string | IRC nickname for the bot |
| `server` | string | IRC server hostname |
| `port` | number | IRC server port (default: 6697 for SSL) |
| `secure` | boolean | Use SSL/TLS connection |
| `discordToken` | string | Discord bot token |
| `channelMapping` | object | Discord ↔ IRC channel mappings |

</details>

<details>
<summary><strong>🎛️ Advanced Features</strong></summary>

```json
{
  "privateMessages": {
    "enabled": true,
    "channelId": "PM_CHANNEL_ID",
    "threadPrefix": "PM: ",
    "autoArchive": 60
  },
  "webhooks": {
    "DISCORD_CHANNEL_ID": "https://discord.com/api/webhooks/..."
  },
  "rateLimiting": {
    "enabled": true,
    "maxMessages": 5,
    "windowMs": 60000,
    "blockDuration": 300000
  },
  "statusNotifications": {
    "enabled": true,
    "joinLeaveChannelId": "CHANNEL_ID",
    "includeJoins": true,
    "includeLeaves": true
  }
}
```

</details>

<details>
<summary><strong>🏢 Enterprise Settings</strong></summary>

```json
{
  "persistence": {
    "type": "redis",
    "config": {
      "host": "localhost",
      "port": 6379,
      "database": 0
    }
  },
  "s3": {
    "enabled": true,
    "endpoint": "https://s3.amazonaws.com",
    "bucket": "discord-attachments",
    "accessKeyId": "ACCESS_KEY",
    "secretAccessKey": "SECRET_KEY"
  },
  "metrics": {
    "enabled": true,
    "port": 3001,
    "path": "/metrics"
  },
  "recovery": {
    "maxRetries": 3,
    "backoffMs": 5000,
    "enableAutoRecover": true
  }
}
```

</details>

### 🌍 Environment Variables

```bash
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id

# IRC Configuration  
IRC_SERVER=irc.libera.chat
IRC_NICKNAME=DiscordBot
IRC_PORT=6697
IRC_SECURE=true

# Database & Storage
REDIS_URL=redis://localhost:6379
S3_BUCKET=discord-attachments
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key

# S3 Configuration Security (Required for /s3 commands)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
S3_CONFIG_ENCRYPTION_KEY=your_64_character_hex_key_here

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=3001
LOG_LEVEL=info
```

---

## 🎮 Discord Commands

### 📊 **Administrative Commands**

#### `/irc-status`
Display comprehensive bridge status and statistics
- IRC server connection details
- Tracked users and channels
- Message synchronization stats
- Rate limiting information
- System health metrics

#### `/irc-users [subcommand]`
Manage and view IRC user information
- `lookup <nick>` - Get detailed user information with WHOIS data
- `search` - Find users by hostname, realname, channel, etc.
- `stats` - Network-wide user statistics
- `refresh <nick>` - Force refresh user information

#### `/irc-channels [subcommand]`
Discover and manage IRC channels
- `list [pattern] [min_users]` - Search available channels with filtering
- `join <channel> [key]` - Join IRC channels dynamically (session only)
- `part <channel> [message]` - Leave IRC channels gracefully
- `info <channel>` - Channel details and comprehensive user lists

### 🔨 **Moderation Commands**

#### `/irc-command [subcommand]`
Execute IRC commands with safety controls
- `send <command> [args]` - Send raw IRC commands (admin only)
- `moderation` - Channel moderation tools (kick, ban, topic, modes)

#### `/irc-who <pattern>`
Advanced user search across the IRC network
- Pattern-based searching with wildcard support
- Real-time WHO query execution with timeout handling
- Comprehensive user information display with connection details

#### `/irc-lists [subcommand]`
View channel access control lists
- `bans <channel>` - View ban list for channel
- `quiets <channel>` - View quiet list for channel
- `exceptions <channel>` - View ban exception list

### 🔧 **System Management**

#### `/irc-metrics [subcommand]`
View detailed IRC bridge metrics and statistics
- `summary` - Show metrics summary with totals and rates
- `detailed` - Show detailed breakdown of all metrics
- `recent` - Show recent activity (last hour)
- `export` - Export metrics in Prometheus format
- `reset` - Reset all metrics (admin only)

#### `/irc-recovery [subcommand]`
Monitor and control error recovery systems
- `status` - View recovery manager health and statistics
- `health` - Detailed health check results for all components
- `trigger` - Manually trigger recovery process (emergency use)

#### `/irc-reconnect`
Force IRC client to reconnect
- Manually disconnect and reconnect IRC connection
- Useful for testing connection recovery or network issues
- 2-second delay between disconnect and reconnect

#### `/pm <nickname> [message]`
Start or continue an IRC private message conversation
- Opens existing PM thread or creates a new one for the IRC user
- Automatically unarchives archived threads
- Optional initial message to send immediately
- Thread links are returned for easy access

#### `/irc-pm [subcommand]`
Manage IRC private message threads
- `list` - List active PM threads
- `cleanup` - Clean up inactive PM threads
- `close <nickname>` - Close a specific PM thread

#### `/irc-ratelimit [subcommand]`
Manage IRC bridge rate limiting
- `status` - Show detailed rate limit statistics
- `blocked` - List currently blocked users
- `unblock <user>` - Unblock a specific user
- `clear <user>` - Clear warnings for a specific user

### 🎨 **Feature Configuration**

#### `/s3 [subcommand]`
Comprehensive S3 file storage management with per-guild configuration

**Configuration Commands** (`/s3 config`)
- `set` - Configure S3 credentials and settings for this server
  - Supports AWS S3, MinIO, DigitalOcean Spaces, Wasabi, and other S3-compatible services
  - Credentials are encrypted with AES-256-GCM before storage
  - Per-guild configuration with customizable bucket, region, endpoint, and key prefix
  - Configurable file size limits (1-100 MB)
- `view` - Display current S3 configuration (credentials hidden)
- `test` - Test S3 connection and verify bucket access
- `remove` - Delete S3 configuration for this server

**File Operations** (`/s3 files`)
- `upload` - Upload attachments to S3 with optional folder organization
  - Returns public URL for sharing
  - Supports custom folder prefixes
  - Validates file size against configured limits
  - Rate limited: 5 uploads per 10 minutes per user
- `list` - Browse uploaded files with pagination support
  - Filter by folder prefix
  - Shows file sizes and last modified timestamps
- `info` - Get detailed file information
  - View file metadata (size, type, last modified, ETag)
  - Display public URL for sharing
  - Show custom S3 metadata if present
- `rename` - Rename files in S3
  - Updates file key/path
  - Returns new public URL
  - Uses copy+delete operation
- `delete` - Delete files with confirmation
  - Interactive button-based confirmation
  - 60-second timeout for safety
  - Prevents accidental deletion

**Share** (`/s3 share`)
- Upload and share files in one streamlined action
  - Upload file to S3
  - Post rich embed with file details in target channel
  - Automatic image preview for image files
  - Optional message/caption support
  - Target channel selection (defaults to current channel)
  - Optional folder organization
  - Rate limited: 5 uploads per 10 minutes per user

**Status** (`/s3 status`)
- Display comprehensive S3 system status and configuration summary

**Requirements:**
- Administrator permissions required
- `S3_CONFIG_ENCRYPTION_KEY` environment variable must be set (see Configuration section)
- S3 bucket must exist and be accessible with provided credentials

#### `/irc-mentions [subcommand]`
Manage IRC-to-Discord mention notifications
- `status` - Show mention detection configuration
- `test <username> <message>` - Test mention detection
- `enable` - Enable mention detection
- `disable` - Disable mention detection

#### `/irc-status-notifications [subcommand]`
Manage IRC status notifications (join/leave/timeout)
- `status` - Show status notification configuration
- `channels` - Show configured notification channels
- `enable` - Enable status notifications
- `disable` - Disable status notifications
- `test <type>` - Send a test notification (join/leave/quit/kick/timeout)

### 🔍 **Information Commands**

#### `/irc-userinfo [subcommand]`
Get detailed information about IRC users
- `lookup <nick>` - Look up detailed information about a specific user
- `search [filters]` - Search for users by nick/hostname/realname/channel
- `stats` - Show IRC user tracking statistics

#### `/irc-channelinfo [subcommand]`
Get detailed information about IRC channels
- `info <channel>` - Get detailed information about a specific channel
- `users <channel>` - List all users in a channel with their modes
- `list` - List all tracked IRC channels

---

## 🛠️ Development & Deployment

### 🔧 Development Setup

```bash
# Clone the repository
git clone https://github.com/tribixbite/irc-disc.git
cd irc-disc

# Install dependencies
npm install

# Set up development environment
cp .env.example .env
# Edit .env with your configuration

# Start in development mode
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run coverage
```

### ⚡ Bun Runtime Support

The bot supports both **Node.js** and **Bun** runtimes with automatic runtime detection.

**Why Use Bun:**
- **Faster SQLite**: Uses native `bun:sqlite` instead of compiled `sqlite3` module
- **Faster startup**: Bun's faster JavaScript engine
- **No compilation**: No need for node-gyp or native build tools
- **Better for Termux/Android**: Works around DNS resolution issues

**Installation with Bun:**
```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies with Bun
bun install

# Run the bot with Bun
bun dist/lib/cli.js --config config.json
```

**Runtime Detection:**
The bot automatically detects which runtime it's running under and uses the appropriate implementations:
- **SQLite Persistence**: `bun:sqlite` on Bun, `sqlite3` on Node.js
- **DNS Resolution**: `Bun.spawn(['ping'])` workaround for Termux/Android
- **Same API**: Identical behavior regardless of runtime

**Performance Comparison:**
| Feature | Node.js | Bun |
|---------|---------|-----|
| SQLite Access | Async (slower) | Synchronous (faster) |
| Startup Time | ~500ms | ~100ms |
| Compilation | Requires node-gyp | No compilation needed |
| Memory Usage | ~80MB | ~60MB |

**Note:** All features work identically on both runtimes. Choose based on your deployment environment and performance needs.

📚 **[Read detailed Bun documentation](docs/BUN_SUPPORT.md)** for architecture details, troubleshooting, and benchmarks.

### 🏗️ Building from Source

```bash
# Build TypeScript
npm run build

# Lint code
npm run lint

# Format code
npm run format

# Type checking
npm run typecheck
```

### 🐳 Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY config/ ./config/

EXPOSE 3000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  irc-disc:
    build: .
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - IRC_SERVER=${IRC_SERVER}
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./config:/app/config
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### 📱 Termux/Android Deployment

Run the bot directly on Android using Termux:

```bash
# Install Termux from F-Droid (not Google Play)
# Open Termux and install dependencies
pkg update && pkg upgrade
pkg install git

# Install Bun (recommended for Android/Termux)
curl -fsSL https://bun.sh/install | bash

# Clone and setup
git clone https://github.com/tribixbite/irc-disc.git
cd irc-disc
bun install
bun run build

# Run the bot
bun dist/lib/cli.js --config config.json
```

**Why Bun is recommended for Termux:**
- No node-gyp compilation issues (common on Android)
- Automatic DNS resolution workaround for Android networking quirks
- ~3x faster startup time
- Lower memory usage

### ☁️ Cloud Deployment

<details>
<summary><strong>🚀 Deploy to Railway</strong></summary>

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/irc-disc)

1. Click the deploy button above
2. Configure environment variables
3. Connect your GitHub repository
4. Deploy automatically

</details>

<details>
<summary><strong>🌊 Deploy to Heroku</strong></summary>

```bash
# Install Heroku CLI and login
heroku login

# Create application
heroku create your-app-name

# Set configuration
heroku config:set DISCORD_TOKEN=your_token
heroku config:set IRC_SERVER=irc.libera.chat

# Deploy
git push heroku main
```

</details>

---

## 🔍 Troubleshooting

### Common Issues

<details>
<summary><strong>🚫 Bot not connecting to Discord</strong></summary>

**Symptoms:** Bot appears offline, no response to commands

**Solutions:**
1. Verify Discord token is correct and not expired
2. Check bot permissions in Discord server
3. Ensure bot has necessary intents enabled
4. Review Discord application settings

```bash
# Test token validity
curl -H "Authorization: Bot YOUR_TOKEN" \
     https://discord.com/api/users/@me
```

</details>

<details>
<summary><strong>📡 IRC connection failures</strong></summary>

**Symptoms:** IRC connection timeouts, authentication errors

**Solutions:**
1. Verify IRC server hostname and port
2. Check if server requires SASL authentication
3. Ensure nickname is not already in use
4. Review IRC server connection logs

```json
{
  "server": "irc.libera.chat",
  "port": 6697,
  "secure": true,
  "sasl": {
    "username": "your_username",
    "password": "your_password"
  }
}
```

</details>

<details>
<summary><strong>💬 Messages not syncing</strong></summary>

**Symptoms:** Messages appear in one platform but not the other

**Solutions:**
1. Verify channel mapping configuration
2. Check bot permissions in both Discord and IRC
3. Review rate limiting settings
4. Examine bridge logs for errors

```bash
# Enable debug logging
LOG_LEVEL=debug npm start
```

</details>

### Debug Mode

Enable comprehensive logging for troubleshooting:

```json
{
  "logLevel": "debug",
  "debugChannels": ["#test-channel"],
  "enableRawLogging": true
}
```

---

## 💾 Database & Backup

### SQLite WAL Mode

The bot uses SQLite with Write-Ahead Logging (WAL) mode for improved concurrency and crash recovery. WAL mode provides significant benefits:

**Benefits:**
- Better write performance with concurrent reads
- Reduced risk of database corruption on crashes
- Automatic recovery from system failures
- Lower disk I/O for write operations

**Important Backup Considerations:**

When backing up the database, you **must** copy **all three files**:
```bash
discord-irc.db          # Main database file
discord-irc.db-wal      # Write-Ahead Log file
discord-irc.db-shm      # Shared memory file
```

**Backup Methods:**

1. **Safe backup (recommended):**
```bash
# Stop the bot first
systemctl stop irc-disc

# Copy all database files
cp discord-irc.db* /backup/location/

# Restart the bot
systemctl start irc-disc
```

2. **Hot backup (requires SQLite CLI):**
```bash
# Backup without stopping the bot
sqlite3 discord-irc.db ".backup /backup/location/discord-irc.db"
```

**Filesystem Requirements:**

WAL mode requires a filesystem that supports shared memory and file locking:
- ✅ ext4, XFS, Btrfs (Linux)
- ✅ APFS, HFS+ (macOS)
- ✅ NTFS (Windows)
- ⚠️ **NOT SUPPORTED:** Network filesystems (NFS, SMB/CIFS)
- ⚠️ **NOT SUPPORTED:** Some Docker volumes on older systems

If running in Docker or on a network filesystem, the bot will fall back to rollback journal mode automatically.

**Monitoring Database Health:**

```bash
# Check database integrity
sqlite3 discord-irc.db "PRAGMA integrity_check;"

# View WAL mode status
sqlite3 discord-irc.db "PRAGMA journal_mode;"

# Check database size and WAL file
ls -lh discord-irc.db*
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### 🛡️ Security

For security concerns, please email security@irc-disc.com instead of using GitHub issues.

### 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🙏 Acknowledgments

- Forked from [discord-irc](https://www.npmjs.com/package/discord-irc) by reactiflux
- Built with [discord.js](https://discord.js.org/) and [irc-upd](https://github.com/Throne3d/node-irc)
- Inspired by the IRC and Discord communities
- Special thanks to all contributors and maintainers

---

<div align="center">

**Made with ❤️ by the Discord-IRC Bridge team**

[⭐ Star us on GitHub](https://github.com/tribixbite/irc-disc) • [🐛 Report Issues](https://github.com/tribixbite/irc-disc/issues) • [💬 Join our Discord](https://discord.gg/your-server)

</div>