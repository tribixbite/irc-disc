"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistenceService = void 0;
const bun_sqlite_1 = require("bun:sqlite");
const logger_1 = require("./logger");
/**
 * Bun-native SQLite persistence service using Bun.Database
 * This is a drop-in replacement for the sqlite3-based PersistenceService
 * with identical API but using Bun's native, faster SQLite implementation
 */
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
        try {
            // Bun's Database constructor is synchronous and fast
            this.db = new bun_sqlite_1.Database(this.dbPath, { create: true });
            logger_1.logger.info(`Connected to SQLite database at ${this.dbPath} (Bun native)`);
            // Enable WAL mode for better concurrency
            try {
                this.db.run('PRAGMA journal_mode = WAL;');
                logger_1.logger.info('SQLite WAL mode enabled for improved concurrency');
            }
            catch (walErr) {
                logger_1.logger.warn('Failed to enable WAL mode, using default journal mode:', walErr);
            }
            // Create tables
            await this.createTables();
        }
        catch (err) {
            logger_1.logger.error('Failed to open database:', err);
            throw err;
        }
    }
    /**
     * Bun's Database API is synchronous and doesn't have SQLITE_BUSY issues
     * like the async sqlite3 library, so this is a simple wrapper for API compatibility
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    async writeWithRetry(operation, _maxRetries = 5, _baseDelay = 50) {
        // Bun's SQLite is synchronous and handles locking internally
        return operation();
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async createTables() {
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
      )`
        ];
        for (const query of queries) {
            this.db.run(query);
        }
    }
    // PM Thread Management
    async savePMThread(ircNick, threadId, channelId) {
        return this.writeWithRetry(() => {
            this.db.run('INSERT OR REPLACE INTO pm_threads (irc_nick, thread_id, channel_id, last_activity) VALUES (?, ?, ?, ?)', [ircNick.toLowerCase(), threadId, channelId, Date.now()]);
        });
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getPMThread(ircNick) {
        const row = this.db.query('SELECT irc_nick as ircNick, thread_id as threadId, channel_id as channelId, last_activity as lastActivity FROM pm_threads WHERE irc_nick = ?').get(ircNick.toLowerCase());
        return row || null;
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getAllPMThreads() {
        const rows = this.db.query('SELECT irc_nick as ircNick, thread_id as threadId FROM pm_threads').all();
        const map = new Map();
        for (const row of rows) {
            map.set(row.ircNick, row.threadId);
        }
        return map;
    }
    async updatePMThreadNick(oldNick, newNick) {
        return this.writeWithRetry(() => {
            this.db.run('UPDATE pm_threads SET irc_nick = ?, last_activity = ? WHERE irc_nick = ?', [newNick.toLowerCase(), Date.now(), oldNick.toLowerCase()]);
        });
    }
    // Channel Users Management
    async saveChannelUsers(channel, users) {
        return this.writeWithRetry(() => {
            const usersJson = JSON.stringify(Array.from(users));
            this.db.run('INSERT OR REPLACE INTO channel_users (channel, users, last_updated) VALUES (?, ?, ?)', [channel.toLowerCase(), usersJson, Date.now()]);
        });
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getChannelUsers(channel) {
        const row = this.db.query('SELECT users FROM channel_users WHERE channel = ?').get(channel.toLowerCase());
        return row ? JSON.parse(row.users) : null;
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getAllChannelUsers() {
        const rows = this.db.query('SELECT channel, users FROM channel_users').all();
        const result = {};
        for (const row of rows) {
            result[row.channel] = JSON.parse(row.users);
        }
        return result;
    }
    // Message Mapping (for edit/delete tracking)
    async saveMessageMapping(discordMessageId, ircChannel, ircMessage, senderNickname) {
        return this.writeWithRetry(() => {
            this.db.run('INSERT OR REPLACE INTO message_mappings (discord_message_id, irc_channel, irc_message, sender_nickname, timestamp) VALUES (?, ?, ?, ?, ?)', [discordMessageId, ircChannel, ircMessage, senderNickname, Date.now()]);
        });
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getMessageMapping(discordMessageId) {
        const row = this.db.query('SELECT irc_channel, irc_message, sender_nickname FROM message_mappings WHERE discord_message_id = ?').get(discordMessageId);
        if (!row)
            return null;
        return {
            ircChannel: row.irc_channel,
            ircMessage: row.irc_message,
            senderNickname: row.sender_nickname
        };
    }
    async deleteMessageMapping(discordMessageId) {
        return this.writeWithRetry(() => {
            this.db.run('DELETE FROM message_mappings WHERE discord_message_id = ?', [discordMessageId]);
        });
    }
    // Metrics Storage
    async saveMetric(key, value) {
        return this.writeWithRetry(() => {
            this.db.run('INSERT OR REPLACE INTO metrics (key, value, updated_at) VALUES (?, ?, ?)', [key, value, Date.now()]);
        });
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getMetric(key) {
        const row = this.db.query('SELECT value FROM metrics WHERE key = ?').get(key);
        return row ? row.value : null;
    }
    /**
     * Save the S3 encryption key to database
     * This key is used to encrypt/decrypt S3 credentials
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    async saveEncryptionKey(key) {
        await this.saveMetric('s3_encryption_key', key);
        logger_1.logger.info('S3 encryption key saved to database');
    }
    /**
     * Get the S3 encryption key from database
     * Returns null if not found
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    async getEncryptionKey() {
        const key = await this.getMetric('s3_encryption_key');
        if (key) {
            logger_1.logger.debug('S3 encryption key loaded from database');
        }
        return key;
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async getAllMetrics() {
        const rows = this.db.query('SELECT key, value FROM metrics').all();
        const result = {};
        for (const row of rows) {
            result[row.key] = row.value;
        }
        return result;
    }
    /**
     * Delete PM thread mapping for a specific IRC nick
     */
    async deletePMThread(ircNick) {
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
    async cleanup() {
        const pmThreadCutoff = Date.now() - (this.cleanupPMThreadDays * 24 * 60 * 60 * 1000);
        const channelUsersCutoff = Date.now() - (this.cleanupChannelUsersDays * 24 * 60 * 60 * 1000);
        // Bun's synchronous API wrapped for API compatibility
        this.db.run('DELETE FROM pm_threads WHERE last_activity < ?', [pmThreadCutoff]);
        this.db.run('DELETE FROM channel_users WHERE last_updated < ?', [channelUsersCutoff]);
        logger_1.logger.debug(`Database cleanup completed (PM threads: ${this.cleanupPMThreadDays}d, Channel users: ${this.cleanupChannelUsersDays}d)`);
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async close() {
        if (this.db) {
            this.db.close();
            logger_1.logger.info('Closed SQLite database connection');
        }
    }
    /**
     * Destroy/cleanup method for compatibility
     */
    destroy() {
        void this.close();
    }
}
exports.PersistenceService = PersistenceService;
