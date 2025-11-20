import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import { logger } from './logger';

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
  secretAccessKey: string; // Decrypted value (not stored)
  keyPrefix?: string;
  publicUrlBase?: string;
  forcePathStyle: boolean;
  maxFileSizeMb: number;
  allowedRoles?: string[];
  createdAt: number;
  updatedAt: number;
}

// Database row types for SQLite queries
interface PMThreadRow {
  irc_nick: string;
  thread_id: string;
  channel_id: string;
  last_activity: number;
}

// Reserved for future use - database row type for channel users table
interface _ChannelUsersRow {
  channel: string;
  users_json: string;
  last_updated: number;
}

// Reserved for future use - database row type for message mapping table
interface _MessageMappingRow {
  discord_id: string;
  irc_channel: string;
  irc_nick: string;
  timestamp: number;
}

// Reserved for future use - database row type for metrics table
interface _MetricRow {
  name: string;
  value: string;
  timestamp: number;
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
 * @param plaintext Secret to encrypt
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

export class PersistenceService {
  private db!: sqlite3.Database;
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
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to open database:', err);
          reject(err);
          return;
        }

        logger.info(`Connected to SQLite database at ${this.dbPath}`);

        // Enable WAL mode for better concurrency and crash recovery
        // NOTE: WAL mode requires backup tools to copy both .db and .db-wal files
        // See README for backup considerations
        this.db.run('PRAGMA journal_mode = WAL;', (walErr) => {
          if (walErr) {
            logger.warn('Failed to enable WAL mode, using default journal mode:', walErr);
          } else {
            logger.info('SQLite WAL mode enabled for improved concurrency');
          }

          // Proceed with table creation regardless of WAL mode result
          this.createTables().then(resolve).catch(reject);
        });
      });
    });
  }

  /**
   * Execute a write operation with automatic retry on SQLITE_BUSY errors
   * Uses exponential backoff with jitter to reduce contention
   *
   * @param operation Function that performs the database write operation
   * @param maxRetries Maximum number of retry attempts (default: 5)
   * @param baseDelay Initial delay in milliseconds (default: 50ms)
   * @returns Promise that resolves when the operation succeeds
   */
  private async writeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 5,
    baseDelay: number = 50
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        // Check if this is a SQLITE_BUSY error (SQLITE_BUSY = 5)
        const errorObj = error as { code?: string; errno?: number };
        const isBusyError = errorObj?.code === 'SQLITE_BUSY' || errorObj?.errno === 5;

        if (!isBusyError || attempt === maxRetries) {
          // Not a busy error or out of retries - throw the error
          throw error;
        }

        // Calculate exponential backoff with jitter
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
        const delay = exponentialDelay + jitter;

        logger.debug(
          `SQLITE_BUSY error on attempt ${attempt + 1}/${maxRetries + 1}, ` +
          `retrying after ${Math.round(delay)}ms`
        );

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never be reached due to the throw in the loop
    throw new Error('writeWithRetry: Unexpected code path');
  }

  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS pm_threads (
        irc_nick TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        last_activity INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS channel_users (
        channel TEXT PRIMARY KEY,
        users TEXT NOT NULL,
        last_updated INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS bot_metrics (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
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
        force_path_style INTEGER DEFAULT 0,
        max_file_size_mb INTEGER DEFAULT 25,
        allowed_roles TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ];

    for (const query of queries) {
      await new Promise<void>((resolve, reject) => {
        this.db.run(query, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    logger.debug('Database tables created/verified');
  }

  async savePMThread(ircNick: string, threadId: string, channelId: string): Promise<void> {
    const now = Date.now();

    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO pm_threads
        (irc_nick, thread_id, channel_id, last_activity)
        VALUES (?, ?, ?, ?)
      `, [ircNick.toLowerCase(), threadId, channelId, now], (err) => {
        if (err) {
          logger.error('Failed to save PM thread:', err);
          reject(err);
        } else {
          logger.debug(`Saved PM thread mapping: ${ircNick} -> ${threadId}`);
          resolve();
        }
      });
    }));
  }

  async getPMThread(ircNick: string): Promise<PMThreadData | null> {
    return new Promise((resolve, _reject) => {
      this.db.get(`
        SELECT irc_nick, thread_id, channel_id, last_activity
        FROM pm_threads
        WHERE irc_nick = ?
      `, [ircNick.toLowerCase()], (err, row: PMThreadRow | undefined) => {
        if (err) {
          logger.error('Failed to get PM thread:', err);
          resolve(null);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ircNick: row.irc_nick,
            threadId: row.thread_id,
            channelId: row.channel_id,
            lastActivity: row.last_activity
          });
        }
      });
    });
  }

  async getAllPMThreads(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    
    return new Promise((resolve) => {
      this.db.all(`
        SELECT irc_nick, thread_id
        FROM pm_threads
      `, (err, rows: PMThreadRow[]) => {
        if (err) {
          logger.error('Failed to load PM threads:', err);
          resolve(result);
        } else {
          for (const row of rows) {
            result.set(row.irc_nick, row.thread_id);
          }
          logger.debug(`Loaded ${result.size} PM thread mappings from database`);
          resolve(result);
        }
      });
    });
  }

  async updatePMThreadNick(oldNick: string, newNick: string): Promise<void> {
    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
      this.db.run(`
        UPDATE pm_threads
        SET irc_nick = ?, last_activity = ?
        WHERE irc_nick = ?
      `, [newNick.toLowerCase(), Date.now(), oldNick.toLowerCase()], (err) => {
        if (err) {
          logger.error('Failed to update PM thread nick:', err);
          reject(err);
        } else {
          logger.debug(`Updated PM thread nick: ${oldNick} -> ${newNick}`);
          resolve();
        }
      });
    }));
  }

  async deletePMThread(ircNick: string): Promise<void> {
    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
      this.db.run(`
        DELETE FROM pm_threads
        WHERE irc_nick = ?
      `, [ircNick.toLowerCase()], (err) => {
        if (err) {
          logger.error('Failed to delete PM thread:', err);
          reject(err);
        } else {
          logger.debug(`Deleted PM thread for: ${ircNick}`);
          resolve();
        }
      });
    }));
  }

  async saveChannelUsers(channel: string, users: Set<string>): Promise<void> {
    const usersArray = Array.from(users);
    const usersJson = JSON.stringify(usersArray);
    const now = Date.now();

    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO channel_users
        (channel, users, last_updated)
        VALUES (?, ?, ?)
      `, [channel, usersJson, now], (err) => {
        if (err) {
          logger.error('Failed to save channel users:', err);
          reject(err);
        } else {
          logger.debug(`Saved ${usersArray.length} users for channel ${channel}`);
          resolve();
        }
      });
    }));
  }

  async getChannelUsers(channel: string): Promise<Set<string>> {
    return new Promise((resolve) => {
      this.db.get(`
        SELECT users
        FROM channel_users
        WHERE channel = ?
      `, [channel], (err, row: { users: string } | undefined) => {
        if (err) {
          logger.error('Failed to get channel users:', err);
          resolve(new Set());
        } else if (!row) {
          resolve(new Set());
        } else {
          try {
            const users = JSON.parse(row.users);
            resolve(new Set(users));
          } catch (parseErr) {
            logger.error('Failed to parse channel users JSON:', parseErr);
            resolve(new Set());
          }
        }
      });
    });
  }

  async getAllChannelUsers(): Promise<Record<string, Set<string>>> {
    const result: Record<string, Set<string>> = {};
    
    return new Promise((resolve) => {
      this.db.all(`
        SELECT channel, users
        FROM channel_users
      `, (err, rows: Array<{ channel: string; users: string }>) => {
        if (err) {
          logger.error('Failed to load channel users:', err);
          resolve(result);
        } else {
          for (const row of rows) {
            try {
              const users = JSON.parse(row.users);
              result[row.channel] = new Set(users);
            } catch (parseErr) {
              logger.error(`Failed to parse channel users for ${row.channel}:`, parseErr);
            }
          }
          logger.debug(`Loaded channel users for ${Object.keys(result).length} channels`);
          resolve(result);
        }
      });
    });
  }

  async saveMetric(key: string, value: string): Promise<void> {
    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO bot_metrics
        (key, value)
        VALUES (?, ?)
      `, [key, value], (err) => {
        if (err) {
          logger.error('Failed to save metric:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    }));
  }

  async getMetric(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.db.get(`
        SELECT value
        FROM bot_metrics
        WHERE key = ?
      `, [key], (err, row: { value: string } | undefined) => {
        if (err) {
          logger.error('Failed to get metric:', err);
          resolve(null);
        } else {
          resolve(row ? row.value : null);
        }
      });
    });
  }

  /**
   * Save S3 configuration for a guild
   * Encrypts the secret access key before storage
   */
  async saveS3Config(config: S3Config): Promise<void> {
    const encryptionKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('S3_CONFIG_ENCRYPTION_KEY environment variable not set');
    }

    const now = Date.now();
    const encryptedSecret = encryptSecret(config.secretAccessKey, encryptionKey);
    const allowedRolesJson = config.allowedRoles ? JSON.stringify(config.allowedRoles) : null;

    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
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
      ], (err) => {
        if (err) {
          logger.error('Failed to save S3 config:', err);
          reject(err);
        } else {
          logger.debug(`Saved S3 config for guild: ${config.guildId}`);
          resolve();
        }
      });
    }));
  }

  /**
   * Get S3 configuration for a guild
   * Decrypts the secret access key before returning
   */
  async getS3Config(guildId: string): Promise<S3Config | null> {
    const encryptionKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('S3_CONFIG_ENCRYPTION_KEY environment variable not set');
    }

    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT * FROM guild_s3_configs WHERE guild_id = ?
      `, [guildId], (err, row: S3ConfigRow | undefined) => {
        if (err) {
          logger.error('Failed to get S3 config:', err);
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          try {
            const secretAccessKey = decryptSecret(row.secret_access_key_encrypted, encryptionKey);
            const allowedRoles = row.allowed_roles ? JSON.parse(row.allowed_roles) : undefined;

            resolve({
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
            });
          } catch (decryptError) {
            logger.error('Failed to decrypt S3 config:', decryptError);
            reject(decryptError instanceof Error ? decryptError : new Error(String(decryptError)));
          }
        }
      });
    });
  }

  /**
   * Delete S3 configuration for a guild
   */
  async deleteS3Config(guildId: string): Promise<void> {
    return this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
      this.db.run(`
        DELETE FROM guild_s3_configs WHERE guild_id = ?
      `, [guildId], (err) => {
        if (err) {
          logger.error('Failed to delete S3 config:', err);
          reject(err);
        } else {
          logger.debug(`Deleted S3 config for guild: ${guildId}`);
          resolve();
        }
      });
    }));
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          logger.error('Error closing database:', err);
        } else {
          logger.info('Database connection closed');
        }
        resolve();
      });
    });
  }

  async cleanup(): Promise<void> {
    const pmThreadCutoff = Date.now() - (this.cleanupPMThreadDays * 24 * 60 * 60 * 1000);
    const channelUsersCutoff = Date.now() - (this.cleanupChannelUsersDays * 24 * 60 * 60 * 1000);

    const queries = [
      // Clean up old PM threads (inactive for more than configured days)
      { sql: 'DELETE FROM pm_threads WHERE last_activity < ?', params: [pmThreadCutoff] },
      // Clean up old channel user data (older than configured days)
      { sql: 'DELETE FROM channel_users WHERE last_updated < ?', params: [channelUsersCutoff] }
    ];

    for (const query of queries) {
      await this.writeWithRetry(async () => new Promise<void>((resolve, reject) => {
        this.db.run(query.sql, query.params, (err) => {
          if (err) {
            logger.error('Failed to cleanup database:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      }));
    }

    logger.debug(`Database cleanup completed (PM threads: ${this.cleanupPMThreadDays}d, Channel users: ${this.cleanupChannelUsersDays}d)`);
  }
}