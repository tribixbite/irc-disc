import { Database } from 'bun:sqlite';
import { logger } from './logger';
import * as crypto from 'node:crypto';

export interface PMThreadData {
  ircNick: string;
  threadId: string;
  channelId: string;
  lastActivity: number;
}

export interface ChannelUserData {
  channel: string;
  users: string[];
  lastUpdated: number;
}

export interface S3Config {
  guildId: string;
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix?: string;
  publicUrlBase?: string;
  forcePathStyle: boolean;
  maxFileSizeMb: number;
  allowedRoles?: string[];
  createdAt: number;
  updatedAt: number;
}

interface S3ConfigRow {
  guild_id: string;
  bucket: string;
  region: string;
  endpoint: string | null;
  access_key_id: string;
  secret_access_key_encrypted: string;
  key_prefix: string | null;
  public_url_base: string | null;
  force_path_style: number;
  max_file_size_mb: number;
  allowed_roles: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Encrypt a secret using AES-256-GCM
 * @param plaintext The secret to encrypt
 * @param key 32-byte hex-encoded encryption key from S3_CONFIG_ENCRYPTION_KEY env var
 * @returns Encrypted string in format: iv:ciphertext:authTag
 */
function encryptSecret(plaintext: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypt a secret using AES-256-GCM
 * @param encrypted Encrypted string in format: iv:ciphertext:authTag
 * @param key 32-byte hex-encoded encryption key from S3_CONFIG_ENCRYPTION_KEY env var
 * @returns Decrypted plaintext secret
 */
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

/**
 * Bun-native SQLite persistence service using Bun.Database
 * This is a drop-in replacement for the sqlite3-based PersistenceService
 * with identical API but using Bun's native, faster SQLite implementation
 */
export class PersistenceService {
  private db!: Database;
  private dbPath: string;
  private cleanupPMThreadDays: number;
  private cleanupChannelUsersDays: number;

  constructor(
    dbPath: string = './discord-irc.db',
    cleanupPMThreadDays: number = 7,
    cleanupChannelUsersDays: number = 1
  ) {
    this.dbPath = dbPath;
    this.cleanupPMThreadDays = cleanupPMThreadDays;
    this.cleanupChannelUsersDays = cleanupChannelUsersDays;
  }

  async initialize(): Promise<void> {
    try {
      // Bun's Database constructor is synchronous and fast
      this.db = new Database(this.dbPath, { create: true });

      logger.info(`Connected to SQLite database at ${this.dbPath} (Bun native)`);

      // Enable WAL mode for better concurrency
      try {
        this.db.run('PRAGMA journal_mode = WAL;');
        logger.info('SQLite WAL mode enabled for improved concurrency');
      } catch (walErr) {
        logger.warn('Failed to enable WAL mode, using default journal mode:', walErr);
      }

      // Create tables
      await this.createTables();
    } catch (err) {
      logger.error('Failed to open database:', err);
      throw err;
    }
  }

  /**
   * Bun's Database API is synchronous and doesn't have SQLITE_BUSY issues
   * like the async sqlite3 library, so this is a simple wrapper for API compatibility
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async writeWithRetry<T>(
    operation: () => T,
    _maxRetries: number = 5,
    _baseDelay: number = 50
  ): Promise<T> {
    // Bun's SQLite is synchronous and handles locking internally
    return operation();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS pm_threads (
        irc_nick TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        last_activity INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS channel_users (
        channel TEXT PRIMARY KEY,
        users TEXT NOT NULL,
        last_updated INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS message_mappings (
        discord_message_id TEXT PRIMARY KEY,
        irc_channel TEXT NOT NULL,
        irc_message TEXT NOT NULL,
        sender_nickname TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS metrics (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS guild_s3_configs (
        guild_id TEXT PRIMARY KEY,
        bucket TEXT NOT NULL,
        region TEXT NOT NULL,
        endpoint TEXT,
        access_key_id TEXT NOT NULL,
        secret_access_key_encrypted TEXT NOT NULL,
        key_prefix TEXT,
        public_url_base TEXT,
        force_path_style INTEGER NOT NULL DEFAULT 0,
        max_file_size_mb INTEGER NOT NULL DEFAULT 10,
        allowed_roles TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ];

    for (const query of queries) {
      this.db.run(query);
    }
  }

  // PM Thread Management
  async savePMThread(ircNick: string, threadId: string, channelId: string): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run(
        'INSERT OR REPLACE INTO pm_threads (irc_nick, thread_id, channel_id, last_activity) VALUES (?, ?, ?, ?)',
        [ircNick.toLowerCase(), threadId, channelId, Date.now()]
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getPMThread(ircNick: string): Promise<PMThreadData | null> {
    const row = this.db.query<PMThreadData, [string]>(
      'SELECT irc_nick as ircNick, thread_id as threadId, channel_id as channelId, last_activity as lastActivity FROM pm_threads WHERE irc_nick = ?'
    ).get(ircNick.toLowerCase());

    return row || null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAllPMThreads(): Promise<Map<string, string>> {
    const rows = this.db.query<{ ircNick: string; threadId: string }, []>(
      'SELECT irc_nick as ircNick, thread_id as threadId FROM pm_threads'
    ).all();

    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.ircNick, row.threadId);
    }
    return map;
  }

  async updatePMThreadNick(oldNick: string, newNick: string): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run(
        'UPDATE pm_threads SET irc_nick = ?, last_activity = ? WHERE irc_nick = ?',
        [newNick.toLowerCase(), Date.now(), oldNick.toLowerCase()]
      );
    });
  }

  // Channel Users Management
  async saveChannelUsers(channel: string, users: Set<string>): Promise<void> {
    return this.writeWithRetry(() => {
      const usersJson = JSON.stringify(Array.from(users));
      this.db.run(
        'INSERT OR REPLACE INTO channel_users (channel, users, last_updated) VALUES (?, ?, ?)',
        [channel.toLowerCase(), usersJson, Date.now()]
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getChannelUsers(channel: string): Promise<string[] | null> {
    const row = this.db.query<{ users: string }, [string]>(
      'SELECT users FROM channel_users WHERE channel = ?'
    ).get(channel.toLowerCase());

    return row ? JSON.parse(row.users) : null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAllChannelUsers(): Promise<Record<string, string[]>> {
    const rows = this.db.query<{ channel: string; users: string }, []>(
      'SELECT channel, users FROM channel_users'
    ).all();

    const result: Record<string, string[]> = {};
    for (const row of rows) {
      result[row.channel] = JSON.parse(row.users);
    }
    return result;
  }

  // Message Mapping (for edit/delete tracking)
  async saveMessageMapping(
    discordMessageId: string,
    ircChannel: string,
    ircMessage: string,
    senderNickname: string
  ): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run(
        'INSERT OR REPLACE INTO message_mappings (discord_message_id, irc_channel, irc_message, sender_nickname, timestamp) VALUES (?, ?, ?, ?, ?)',
        [discordMessageId, ircChannel, ircMessage, senderNickname, Date.now()]
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getMessageMapping(discordMessageId: string): Promise<{
    ircChannel: string;
    ircMessage: string;
    senderNickname: string;
  } | null> {
    const row = this.db.query<{
      irc_channel: string;
      irc_message: string;
      sender_nickname: string;
    }, [string]>(
      'SELECT irc_channel, irc_message, sender_nickname FROM message_mappings WHERE discord_message_id = ?'
    ).get(discordMessageId);

    if (!row) return null;

    return {
      ircChannel: row.irc_channel,
      ircMessage: row.irc_message,
      senderNickname: row.sender_nickname
    };
  }

  async deleteMessageMapping(discordMessageId: string): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run('DELETE FROM message_mappings WHERE discord_message_id = ?', [discordMessageId]);
    });
  }

  // Metrics Storage
  async saveMetric(key: string, value: string): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run(
        'INSERT OR REPLACE INTO metrics (key, value, updated_at) VALUES (?, ?, ?)',
        [key, value, Date.now()]
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getMetric(key: string): Promise<string | null> {
    const row = this.db.query<{ value: string }, [string]>(
      'SELECT value FROM metrics WHERE key = ?'
    ).get(key);

    return row ? row.value : null;
  }

  /**
   * Save the S3 encryption key to database
   * This key is used to encrypt/decrypt S3 credentials
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async saveEncryptionKey(key: string): Promise<void> {
    await this.saveMetric('s3_encryption_key', key);
    logger.info('S3 encryption key saved to database');
  }

  /**
   * Get the S3 encryption key from database
   * Returns null if not found
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getEncryptionKey(): Promise<string | null> {
    const key = await this.getMetric('s3_encryption_key');
    if (key) {
      logger.debug('S3 encryption key loaded from database');
    }
    return key;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAllMetrics(): Promise<Record<string, string>> {
    const rows = this.db.query<{ key: string; value: string }, []>(
      'SELECT key, value FROM metrics'
    ).all();

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /**
   * Delete PM thread mapping for a specific IRC nick
   */
  async deletePMThread(ircNick: string): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run('DELETE FROM pm_threads WHERE irc_nick = ?', [ircNick.toLowerCase()]);
    });
  }

  /**
   * Cleanup old data from the database
   * - Removes PM threads inactive for more than configured days (default: 7 days)
   * - Removes channel user data older than configured days (default: 1 day)
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async cleanup(): Promise<void> {
    const pmThreadCutoff = Date.now() - (this.cleanupPMThreadDays * 24 * 60 * 60 * 1000);
    const channelUsersCutoff = Date.now() - (this.cleanupChannelUsersDays * 24 * 60 * 60 * 1000);

    // Bun's synchronous API wrapped for API compatibility
    this.db.run('DELETE FROM pm_threads WHERE last_activity < ?', [pmThreadCutoff]);
    this.db.run('DELETE FROM channel_users WHERE last_updated < ?', [channelUsersCutoff]);

    logger.debug(`Database cleanup completed (PM threads: ${this.cleanupPMThreadDays}d, Channel users: ${this.cleanupChannelUsersDays}d)`);
  }

  /**
   * Save S3 configuration for a guild
   * Encrypts the secret access key before storing
   */
  async saveS3Config(config: S3Config): Promise<void> {
    const encryptionKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('S3_CONFIG_ENCRYPTION_KEY environment variable not set');
    }

    const now = Date.now();
    const encryptedSecret = encryptSecret(config.secretAccessKey, encryptionKey);
    const allowedRolesJson = config.allowedRoles ? JSON.stringify(config.allowedRoles) : null;

    return this.writeWithRetry(() => {
      this.db.run(`
        INSERT OR REPLACE INTO guild_s3_configs
        (guild_id, bucket, region, endpoint, access_key_id, secret_access_key_encrypted,
         key_prefix, public_url_base, force_path_style, max_file_size_mb, allowed_roles,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                COALESCE((SELECT created_at FROM guild_s3_configs WHERE guild_id = ?), ?), ?)
      `, [
        config.guildId,
        config.bucket,
        config.region,
        config.endpoint || null,
        config.accessKeyId,
        encryptedSecret,
        config.keyPrefix || null,
        config.publicUrlBase || null,
        config.forcePathStyle ? 1 : 0,
        config.maxFileSizeMb,
        allowedRolesJson,
        config.guildId, // for COALESCE
        now, // created_at if new
        now  // updated_at always
      ]);
      logger.debug(`Saved S3 config for guild: ${config.guildId}`);
    });
  }

  /**
   * Get S3 configuration for a guild
   * Decrypts the secret access key before returning
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getS3Config(guildId: string): Promise<S3Config | null> {
    const encryptionKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('S3_CONFIG_ENCRYPTION_KEY environment variable not set');
    }

    const row = this.db.query<S3ConfigRow, [string]>(`
      SELECT * FROM guild_s3_configs WHERE guild_id = ?
    `).get(guildId);

    if (!row) {
      return null;
    }

    try {
      const secretAccessKey = decryptSecret(row.secret_access_key_encrypted, encryptionKey);
      const allowedRoles = row.allowed_roles ? JSON.parse(row.allowed_roles) : undefined;

      return {
        guildId: row.guild_id,
        bucket: row.bucket,
        region: row.region,
        endpoint: row.endpoint || undefined,
        accessKeyId: row.access_key_id,
        secretAccessKey,
        keyPrefix: row.key_prefix || undefined,
        publicUrlBase: row.public_url_base || undefined,
        forcePathStyle: row.force_path_style === 1,
        maxFileSizeMb: row.max_file_size_mb,
        allowedRoles,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (decryptError) {
      logger.error('Failed to decrypt S3 config:', decryptError);
      throw decryptError instanceof Error ? decryptError : new Error(String(decryptError));
    }
  }

  /**
   * Delete S3 configuration for a guild
   */
  async deleteS3Config(guildId: string): Promise<void> {
    return this.writeWithRetry(() => {
      this.db.run(`
        DELETE FROM guild_s3_configs WHERE guild_id = ?
      `, [guildId]);
      logger.debug(`Deleted S3 config for guild: ${guildId}`);
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      logger.info('Closed SQLite database connection');
    }
  }

  /**
   * Destroy/cleanup method for compatibility
   */
  destroy(): void {
    void this.close();
  }
}
