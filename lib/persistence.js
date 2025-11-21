"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistenceService = void 0;
const sqlite3_1 = __importDefault(require("sqlite3"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("./logger");
/**
 * Encrypt a secret using AES-256-GCM
 * @param plaintext Secret to encrypt
 * @param key 32-byte hex-encoded encryption key from S3_CONFIG_ENCRYPTION_KEY env var
 * @returns Encrypted string in format: iv:ciphertext:authTag
 */
function encryptSecret(plaintext, key) {
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
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
function decryptSecret(encrypted, key) {
    const [ivHex, ciphertext, authTagHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
class PersistenceService {
    db;
    dbPath;
    cleanupPMThreadDays;
    cleanupChannelUsersDays;
    constructor(dbPath = './discord-irc.db', cleanupPMThreadDays = 7, cleanupChannelUsersDays = 1) {
        this.dbPath = dbPath;
        this.cleanupPMThreadDays = cleanupPMThreadDays;
        this.cleanupChannelUsersDays = cleanupChannelUsersDays;
    }
    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3_1.default.Database(this.dbPath, (err) => {
                if (err) {
                    logger_1.logger.error('Failed to open database:', err);
                    reject(err);
                    return;
                }
                logger_1.logger.info(`Connected to SQLite database at ${this.dbPath}`);
                // Enable WAL mode for better concurrency and crash recovery
                // NOTE: WAL mode requires backup tools to copy both .db and .db-wal files
                // See README for backup considerations
                this.db.run('PRAGMA journal_mode = WAL;', (walErr) => {
                    if (walErr) {
                        logger_1.logger.warn('Failed to enable WAL mode, using default journal mode:', walErr);
                    }
                    else {
                        logger_1.logger.info('SQLite WAL mode enabled for improved concurrency');
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
    async writeWithRetry(operation, maxRetries = 5, baseDelay = 50) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                // Check if this is a SQLITE_BUSY error (SQLITE_BUSY = 5)
                const errorObj = error;
                const isBusyError = errorObj?.code === 'SQLITE_BUSY' || errorObj?.errno === 5;
                if (!isBusyError || attempt === maxRetries) {
                    // Not a busy error or out of retries - throw the error
                    throw error;
                }
                // Calculate exponential backoff with jitter
                const exponentialDelay = baseDelay * Math.pow(2, attempt);
                const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
                const delay = exponentialDelay + jitter;
                logger_1.logger.debug(`SQLITE_BUSY error on attempt ${attempt + 1}/${maxRetries + 1}, ` +
                    `retrying after ${Math.round(delay)}ms`);
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        // This should never be reached due to the throw in the loop
        throw new Error('writeWithRetry: Unexpected code path');
    }
    async createTables() {
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
            await new Promise((resolve, reject) => {
                this.db.run(query, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }
        logger_1.logger.debug('Database tables created/verified');
    }
    async savePMThread(ircNick, threadId, channelId) {
        const now = Date.now();
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
            this.db.run(`
        INSERT OR REPLACE INTO pm_threads
        (irc_nick, thread_id, channel_id, last_activity)
        VALUES (?, ?, ?, ?)
      `, [ircNick.toLowerCase(), threadId, channelId, now], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to save PM thread:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.debug(`Saved PM thread mapping: ${ircNick} -> ${threadId}`);
                    resolve();
                }
            });
        }));
    }
    async getPMThread(ircNick) {
        return new Promise((resolve, _reject) => {
            this.db.get(`
        SELECT irc_nick, thread_id, channel_id, last_activity
        FROM pm_threads
        WHERE irc_nick = ?
      `, [ircNick.toLowerCase()], (err, row) => {
                if (err) {
                    logger_1.logger.error('Failed to get PM thread:', err);
                    resolve(null);
                }
                else if (!row) {
                    resolve(null);
                }
                else {
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
    async getAllPMThreads() {
        const result = new Map();
        return new Promise((resolve) => {
            this.db.all(`
        SELECT irc_nick, thread_id
        FROM pm_threads
      `, (err, rows) => {
                if (err) {
                    logger_1.logger.error('Failed to load PM threads:', err);
                    resolve(result);
                }
                else {
                    for (const row of rows) {
                        result.set(row.irc_nick, row.thread_id);
                    }
                    logger_1.logger.debug(`Loaded ${result.size} PM thread mappings from database`);
                    resolve(result);
                }
            });
        });
    }
    async updatePMThreadNick(oldNick, newNick) {
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
            this.db.run(`
        UPDATE pm_threads
        SET irc_nick = ?, last_activity = ?
        WHERE irc_nick = ?
      `, [newNick.toLowerCase(), Date.now(), oldNick.toLowerCase()], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to update PM thread nick:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.debug(`Updated PM thread nick: ${oldNick} -> ${newNick}`);
                    resolve();
                }
            });
        }));
    }
    async deletePMThread(ircNick) {
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
            this.db.run(`
        DELETE FROM pm_threads
        WHERE irc_nick = ?
      `, [ircNick.toLowerCase()], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to delete PM thread:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.debug(`Deleted PM thread for: ${ircNick}`);
                    resolve();
                }
            });
        }));
    }
    async saveChannelUsers(channel, users) {
        const usersArray = Array.from(users);
        const usersJson = JSON.stringify(usersArray);
        const now = Date.now();
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
            this.db.run(`
        INSERT OR REPLACE INTO channel_users
        (channel, users, last_updated)
        VALUES (?, ?, ?)
      `, [channel, usersJson, now], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to save channel users:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.debug(`Saved ${usersArray.length} users for channel ${channel}`);
                    resolve();
                }
            });
        }));
    }
    async getChannelUsers(channel) {
        return new Promise((resolve) => {
            this.db.get(`
        SELECT users
        FROM channel_users
        WHERE channel = ?
      `, [channel], (err, row) => {
                if (err) {
                    logger_1.logger.error('Failed to get channel users:', err);
                    resolve(new Set());
                }
                else if (!row) {
                    resolve(new Set());
                }
                else {
                    try {
                        const users = JSON.parse(row.users);
                        resolve(new Set(users));
                    }
                    catch (parseErr) {
                        logger_1.logger.error('Failed to parse channel users JSON:', parseErr);
                        resolve(new Set());
                    }
                }
            });
        });
    }
    async getAllChannelUsers() {
        const result = {};
        return new Promise((resolve) => {
            this.db.all(`
        SELECT channel, users
        FROM channel_users
      `, (err, rows) => {
                if (err) {
                    logger_1.logger.error('Failed to load channel users:', err);
                    resolve(result);
                }
                else {
                    for (const row of rows) {
                        try {
                            const users = JSON.parse(row.users);
                            result[row.channel] = new Set(users);
                        }
                        catch (parseErr) {
                            logger_1.logger.error(`Failed to parse channel users for ${row.channel}:`, parseErr);
                        }
                    }
                    logger_1.logger.debug(`Loaded channel users for ${Object.keys(result).length} channels`);
                    resolve(result);
                }
            });
        });
    }
    async saveMetric(key, value) {
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
            this.db.run(`
        INSERT OR REPLACE INTO bot_metrics
        (key, value)
        VALUES (?, ?)
      `, [key, value], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to save metric:', err);
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        }));
    }
    async getMetric(key) {
        return new Promise((resolve) => {
            this.db.get(`
        SELECT value
        FROM bot_metrics
        WHERE key = ?
      `, [key], (err, row) => {
                if (err) {
                    logger_1.logger.error('Failed to get metric:', err);
                    resolve(null);
                }
                else {
                    resolve(row ? row.value : null);
                }
            });
        });
    }
    /**
     * Save the S3 encryption key to database
     * This key is used to encrypt/decrypt S3 credentials
     */
    async saveEncryptionKey(key) {
        await this.saveMetric('s3_encryption_key', key);
        logger_1.logger.info('S3 encryption key saved to database');
    }
    /**
     * Get the S3 encryption key from database
     * Returns null if not found
     */
    async getEncryptionKey() {
        const key = await this.getMetric('s3_encryption_key');
        if (key) {
            logger_1.logger.debug('S3 encryption key loaded from database');
        }
        return key;
    }
    /**
     * Save S3 configuration for a guild
     * Encrypts the secret access key before storage
     */
    async saveS3Config(config) {
        const encryptionKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
        if (!encryptionKey) {
            throw new Error('S3_CONFIG_ENCRYPTION_KEY environment variable not set');
        }
        const now = Date.now();
        const encryptedSecret = encryptSecret(config.secretAccessKey, encryptionKey);
        const allowedRolesJson = config.allowedRoles ? JSON.stringify(config.allowedRoles) : null;
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
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
                now // updated_at always
            ], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to save S3 config:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.debug(`Saved S3 config for guild: ${config.guildId}`);
                    resolve();
                }
            });
        }));
    }
    /**
     * Get S3 configuration for a guild
     * Decrypts the secret access key before returning
     */
    async getS3Config(guildId) {
        const encryptionKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
        if (!encryptionKey) {
            throw new Error('S3_CONFIG_ENCRYPTION_KEY environment variable not set');
        }
        return new Promise((resolve, reject) => {
            this.db.get(`
        SELECT * FROM guild_s3_configs WHERE guild_id = ?
      `, [guildId], (err, row) => {
                if (err) {
                    logger_1.logger.error('Failed to get S3 config:', err);
                    reject(err);
                }
                else if (!row) {
                    resolve(null);
                }
                else {
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
                    }
                    catch (decryptError) {
                        logger_1.logger.error('Failed to decrypt S3 config:', decryptError);
                        reject(decryptError instanceof Error ? decryptError : new Error(String(decryptError)));
                    }
                }
            });
        });
    }
    /**
     * Delete S3 configuration for a guild
     */
    async deleteS3Config(guildId) {
        return this.writeWithRetry(async () => new Promise((resolve, reject) => {
            this.db.run(`
        DELETE FROM guild_s3_configs WHERE guild_id = ?
      `, [guildId], (err) => {
                if (err) {
                    logger_1.logger.error('Failed to delete S3 config:', err);
                    reject(err);
                }
                else {
                    logger_1.logger.debug(`Deleted S3 config for guild: ${guildId}`);
                    resolve();
                }
            });
        }));
    }
    async close() {
        return new Promise((resolve) => {
            this.db.close((err) => {
                if (err) {
                    logger_1.logger.error('Error closing database:', err);
                }
                else {
                    logger_1.logger.info('Database connection closed');
                }
                resolve();
            });
        });
    }
    async cleanup() {
        const pmThreadCutoff = Date.now() - (this.cleanupPMThreadDays * 24 * 60 * 60 * 1000);
        const channelUsersCutoff = Date.now() - (this.cleanupChannelUsersDays * 24 * 60 * 60 * 1000);
        const queries = [
            // Clean up old PM threads (inactive for more than configured days)
            { sql: 'DELETE FROM pm_threads WHERE last_activity < ?', params: [pmThreadCutoff] },
            // Clean up old channel user data (older than configured days)
            { sql: 'DELETE FROM channel_users WHERE last_updated < ?', params: [channelUsersCutoff] }
        ];
        for (const query of queries) {
            await this.writeWithRetry(async () => new Promise((resolve, reject) => {
                this.db.run(query.sql, query.params, (err) => {
                    if (err) {
                        logger_1.logger.error('Failed to cleanup database:', err);
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            }));
        }
        logger_1.logger.debug(`Database cleanup completed (PM threads: ${this.cleanupPMThreadDays}d, Channel users: ${this.cleanupChannelUsersDays}d)`);
    }
}
exports.PersistenceService = PersistenceService;
