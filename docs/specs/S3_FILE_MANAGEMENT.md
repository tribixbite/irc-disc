# S3 File Management System Specification

## Implementation Status

### Phase 1: Foundation (✅ COMPLETED)
- ✅ Database schema: `guild_s3_configs` table
- ✅ AES-256-GCM encryption/decryption for S3 secrets
- ✅ S3 config persistence methods (save/get/delete)
- ✅ Enhanced S3Uploader with list/metadata/rename/delete methods
- ✅ Support for S3-compatible services (MinIO, DigitalOcean Spaces, etc.)
- ✅ Pagination support for file listing

### Phase 2: Slash Commands (✅ COMPLETED)
- ✅ `/s3 config` subcommand group (set, view, test, remove)
- ✅ `/s3 files` subcommand group (upload, list, info, rename, delete)
- ✅ `/s3 status` enhanced command
- ✅ File info command with metadata display
- ✅ File rename with copy+delete operation
- ✅ File delete with interactive confirmation (60s timeout)
- ⏳ `/s3 share` command with image preview - deferred
- ⏳ Rate limiting for uploads - deferred
- ⏳ Pagination UI with buttons - deferred

**Implementation Complete**: Full S3 file management is functional with all core CRUD operations. Future enhancements marked as deferred can be added incrementally.

## Overview

Comprehensive S3 file management via Discord slash commands with secure configuration, full file operations, and upload+share workflows.

## Current System

- `S3Uploader` class with enhanced functionality (list, metadata, rename, delete)
- `/irc-s3` command with only: status, test, stats
- Configuration via environment variables or database (per-guild)
- Database encryption for S3 credentials

## New System Architecture

### Command Structure

```
/s3
├── config (subcommand group)
│   ├── set     - Configure S3 credentials via modal
│   ├── view    - Show current configuration (non-secret)
│   ├── test    - Test S3 connection
│   └── remove  - Clear S3 configuration
├── files (subcommand group)
│   ├── upload  - Upload file to S3
│   ├── list    - List files with pagination
│   ├── info    - Get file metadata
│   ├── rename  - Rename a file
│   └── delete  - Delete a file (with confirmation)
├── share       - Upload file and share link in channel/thread
└── status      - General S3 status and statistics
```

## Database Schema

### New Table: `guild_s3_configs`

```sql
CREATE TABLE guild_s3_configs (
  guild_id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  region TEXT NOT NULL,
  endpoint TEXT,                  -- For S3-compatible services
  access_key_id TEXT NOT NULL,
  secret_access_key_encrypted TEXT NOT NULL,  -- AES-256-GCM encrypted
  key_prefix TEXT,               -- Optional path prefix
  public_url_base TEXT,          -- Custom CDN URL
  force_path_style INTEGER DEFAULT 0,
  max_file_size_mb INTEGER DEFAULT 25,
  allowed_roles TEXT,            -- JSON array of role IDs
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Encryption

- `secret_access_key` encrypted using AES-256-GCM
- Encryption key from environment variable: `S3_CONFIG_ENCRYPTION_KEY`
- IV stored with encrypted data (prefix format: `iv:ciphertext`)

## Security Model

### Permission System

1. **Admin-only by default** - All `/s3` commands require Administrator permission
2. **Role-based access** (future) - Configure specific roles via `allowed_roles`
3. **Credential handling** - Never log or display secrets

### Rate Limiting

- **Upload limit**: 5 files per user per 10 minutes
- **List limit**: 10 requests per minute
- Implement token bucket algorithm

### File Restrictions

Per-guild configurable:
- **Max file size**: Default 25MB, max 100MB
- **Allowed types** (optional): MIME type allowlist
- **Blocked types**: Executables (.exe, .bat, .sh, etc.)

## Implementation Details

### 1. `/s3 config set`

```typescript
// Flow
1. User runs /s3 config set
2. Bot responds with button: "Configure S3"
3. User clicks button → Discord Modal opens
4. Modal fields:
   - Bucket Name (required)
   - Region (required)
   - Endpoint (optional, for S3-compatible)
   - Access Key ID (required)
   - Secret Access Key (required)
   - Key Prefix (optional)
5. User submits → Bot validates and saves to DB
6. Ephemeral confirmation
```

**Modal Implementation:**
```typescript
const modal = new Modal()
  .setCustomId('s3_config_modal')
  .setTitle('Configure S3 Storage')
  .addComponents(
    new TextInputComponent()
      .setCustomId('bucket')
      .setLabel('Bucket Name')
      .setStyle('SHORT')
      .setRequired(true),
    new TextInputComponent()
      .setCustomId('region')
      .setLabel('Region')
      .setPlaceholder('us-east-1')
      .setStyle('SHORT')
      .setRequired(true),
    // ... more fields
  );
```

**Encryption:**
```typescript
import crypto from 'crypto';

function encryptSecret(plaintext: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

function decryptSecret(encrypted: string, key: string): string {
  const [ivHex, ciphertext, authTagHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 2. `/s3 files list`

```typescript
// Command options
{
  prefix: string (optional) // Filter by prefix/folder
  page: integer (optional)  // Page number (internal use)
}

// Implementation
1. Fetch guild S3 config from DB
2. Call ListObjectsV2Command with:
   - Bucket
   - Prefix (from command option)
   - MaxKeys: 20
   - ContinuationToken (if pagination)
3. Build embed:
   - Title: "Files in bucket-name"
   - Description: List files (name, size, date)
   - Footer: "Page 1 of X"
4. Add buttons:
   - Previous (disabled if first page)
   - Next (disabled if last page)
5. Store continuation token in button customId
```

**Embed Format:**
```
📁 Files in my-bucket (prefix: images/)

image1.png          1.2 MB    2 days ago
image2.jpg          3.4 MB    5 days ago
document.pdf        890 KB    1 week ago

Page 1 of 5
[<< Previous] [Next >>]
```

**Button Handler:**
```typescript
// Parse button customId: "s3_list_next_TOKEN" or "s3_list_prev_TOKEN"
const [_, action, token] = customId.split('_', 3);
const continuationToken = token !== 'null' ? token : undefined;

// Make S3 API call with token
// Update message with new embed and buttons
```

### 3. `/s3 files upload`

```typescript
// Command options
{
  file: attachment (required)
  name: string (optional) // Custom filename
  folder: string (optional) // S3 prefix/folder
}

// Implementation
1. Check file size against guild limit
2. Check file type against allowlist/blocklist
3. Defer reply: "Uploading..."
4. Fetch file from Discord CDN
5. Upload to S3 with key: folder/name or folder/original-name
6. Edit reply with success embed:
   - File name
   - Size
   - Public URL
   - Copy button for URL
```

### 4. `/s3 files rename`

```typescript
// Command options
{
  old_key: string (required)
  new_key: string (required)
}

// Implementation
1. Defer reply
2. CopyObjectCommand: old_key → new_key
3. DeleteObjectCommand: old_key
4. Edit reply: "✅ Renamed old_key to new_key"
```

### 5. `/s3 files delete`

```typescript
// Command options
{
  key: string (required)
}

// Implementation
1. Respond with confirmation embed
2. Add buttons: "Confirm Delete" | "Cancel"
3. If confirmed:
   - DeleteObjectCommand
   - Edit message: "✅ Deleted file_name"
4. If cancelled:
   - Edit message: "❌ Delete cancelled"
```

### 6. `/s3 files info`

```typescript
// Command options
{
  key: string (required)
}

// Implementation
1. HeadObjectCommand to get metadata
2. Build embed:
   - File: key
   - Size: ContentLength
   - Type: ContentType
   - Modified: LastModified
   - ETag: ETag
   - URL: public URL
```

### 7. `/s3 share`

**Primary use case**: Upload file and share link in one command

```typescript
// Command options
{
  file: attachment (required)
  channel: channel (optional) // Default: current channel
  message: string (optional)  // Optional caption
}

// Implementation
1. Defer reply (ephemeral)
2. Check file size/type limits
3. Fetch file from Discord CDN
4. Upload to S3
5. Send to target channel:
   - Rich embed with file preview (if image)
   - File name, size, type
   - Public URL link
   - User's optional message
6. Delete deferred reply or edit: "✅ Upload complete!"
```

**Share Embed Format:**
```
📎 File Shared: document.pdf

1.2 MB • application/pdf
Shared by @username

"Here's the report we discussed"

🔗 https://cdn.example.com/files/document.pdf

[Copy Link]
```

**Image Preview:**
- If MIME type is `image/*`, use S3 URL as embed image
- Generates inline preview in Discord

## S3Uploader Enhancements

### New Methods to Add

```typescript
class S3Uploader {
  // ... existing uploadFile, testConnection

  async listObjects(prefix?: string, continuationToken?: string): Promise<ListResult> {
    // ListObjectsV2Command
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata> {
    // HeadObjectCommand
  }

  async renameObject(oldKey: string, newKey: string): Promise<void> {
    // CopyObjectCommand + DeleteObjectCommand
  }

  async deleteObject(key: string): Promise<void> {
    // DeleteObjectCommand
  }

  async getObjectUrl(key: string, expiresIn?: number): Promise<string> {
    // Generate signed or public URL
  }
}

interface ListResult {
  objects: S3Object[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

interface ObjectMetadata {
  contentType: string;
  contentLength: number;
  lastModified: Date;
  etag: string;
  metadata: Record<string, string>;
}
```

## Persistence Layer

### New Methods in Persistence

```typescript
// lib/persistence.ts additions

interface S3Config {
  guildId: string;
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKeyEncrypted: string;
  keyPrefix?: string;
  publicUrlBase?: string;
  forcePathStyle: boolean;
  maxFileSizeMb: number;
  allowedRoles?: string[];
}

async saveS3Config(config: S3Config): Promise<void>
async getS3Config(guildId: string): Promise<S3Config | null>
async deleteS3Config(guildId: string): Promise<void>
```

## Error Handling

### Common Errors

| Error | User Message |
|-------|-------------|
| No config set | "S3 not configured. Use `/s3 config set` to get started." |
| Invalid credentials | "S3 authentication failed. Check your access keys." |
| Bucket not found | "Bucket '{bucket}' not found. Verify it exists." |
| Permission denied | "Access denied. Check bucket permissions." |
| File too large | "File exceeds {limit}MB limit." |
| File type blocked | "File type '{type}' is not allowed." |
| Rate limited | "Too many uploads. Try again in {seconds}s." |
| Network error | "Failed to connect to S3. Check endpoint/region." |

## Testing Plan

### Unit Tests
- [ ] Encryption/decryption functions
- [ ] S3Uploader new methods
- [ ] Permission checks
- [ ] Rate limiting logic

### Integration Tests
- [ ] Config modal flow
- [ ] Upload with file size limits
- [ ] List with pagination
- [ ] Rename operation (copy + delete)
- [ ] Delete with confirmation
- [ ] Share to channel vs thread

### Manual Tests
- [ ] Configure S3 via modal
- [ ] Upload various file types
- [ ] Test pagination with >20 files
- [ ] Rename file and verify URL changes
- [ ] Delete file and confirm removal
- [ ] Share file with image preview

## Migration Plan

1. **Database Migration**: Create `guild_s3_configs` table
2. **Environment Variable**: Add `S3_CONFIG_ENCRYPTION_KEY` (32-byte hex)
3. **Backward Compatibility**: Keep env var config as fallback
4. **Command Update**: Move from `/irc-s3` to `/s3`
5. **Documentation**: Update README with new commands

## Future Enhancements

- **Folder navigation**: Virtual folder structure in list UI
- **Bulk operations**: Multi-select delete/move
- **Search**: Advanced filters (date range, size, type)
- **CDN integration**: CloudFlare, Fastly support
- **Presigned URLs**: Time-limited access links
- **Upload progress**: Real-time upload progress bar
- **Thumbnails**: Generate/cache thumbnails for images
- **Access logs**: Track who accessed what files
