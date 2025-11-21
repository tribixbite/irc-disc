"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
const lru_cache_1 = require("lru-cache");
const logger_1 = require("./logger");
class RateLimiter {
    config;
    // Use LRU cache to prevent memory leaks from unbounded user tracking
    // Automatically evicts least recently used entries when limit is reached
    userActivity;
    cleanupInterval;
    constructor(config = {}) {
        this.config = {
            maxMessagesPerMinute: 20,
            maxMessagesPerHour: 300,
            duplicateMessageThreshold: 3,
            duplicateTimeWindow: 30 * 1000, // 30 seconds
            burstLimit: 5,
            burstWindow: 10 * 1000, // 10 seconds
            spamCooldownMinutes: 5,
            rateLimitCooldownSeconds: 30,
            ...config
        };
        // Initialize LRU cache with 10,000 user limit
        // Entries automatically expire after 7 days of inactivity
        this.userActivity = new lru_cache_1.LRUCache({
            max: 10000,
            ttl: 1000 * 60 * 60 * 24 * 7, // 7 days TTL
            updateAgeOnGet: true, // Refresh TTL on access
        });
        // Clean up old user activity every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldActivity();
        }, 5 * 60 * 1000);
        logger_1.logger.info('Rate limiter initialized with LRU cache (max: 10000 users, TTL: 7 days)');
    }
    /**
     * Check if a user is allowed to send a message
     * Returns null if allowed, or a reason string if blocked
     */
    checkMessage(userId, username, messageContent) {
        const now = Date.now();
        let user = this.userActivity.get(userId);
        if (!user) {
            user = {
                userId,
                username,
                messageCount: 0,
                lastMessage: 0,
                recentMessages: [],
                messageHistory: [],
                warningCount: 0,
                isBlocked: false,
                blockedUntil: 0,
                lastWarning: 0
            };
            this.userActivity.set(userId, user);
        }
        // Update username if it changed
        user.username = username;
        // Check if user is currently blocked
        if (user.isBlocked && now < user.blockedUntil) {
            const remainingTime = Math.ceil((user.blockedUntil - now) / 1000);
            return `User is temporarily blocked for ${remainingTime} seconds due to spam/rate limiting`;
        }
        // Unblock user if cooldown period has passed
        if (user.isBlocked && now >= user.blockedUntil) {
            user.isBlocked = false;
            user.warningCount = 0;
            logger_1.logger.info(`User ${username} (${userId}) has been unblocked`);
        }
        // Clean old messages from history
        const minuteAgo = now - 60 * 1000;
        const hourAgo = now - 60 * 60 * 1000;
        user.recentMessages = user.recentMessages.filter(timestamp => timestamp > hourAgo);
        user.messageHistory = user.messageHistory.slice(-10); // Keep last 10 messages
        // Check burst rate (short-term flooding)
        const recentBurstMessages = user.recentMessages.filter(timestamp => timestamp > now - this.config.burstWindow);
        if (recentBurstMessages.length >= this.config.burstLimit) {
            return this.handleRateLimit(user, `burst limit exceeded (${recentBurstMessages.length}/${this.config.burstLimit} in ${this.config.burstWindow / 1000}s)`);
        }
        // Check per-minute rate
        const recentMinuteMessages = user.recentMessages.filter(timestamp => timestamp > minuteAgo);
        if (recentMinuteMessages.length >= this.config.maxMessagesPerMinute) {
            return this.handleRateLimit(user, `per-minute limit exceeded (${recentMinuteMessages.length}/${this.config.maxMessagesPerMinute})`);
        }
        // Check per-hour rate
        if (user.recentMessages.length >= this.config.maxMessagesPerHour) {
            return this.handleRateLimit(user, `per-hour limit exceeded (${user.recentMessages.length}/${this.config.maxMessagesPerHour})`);
        }
        // Check for duplicate messages (spam detection)
        const recentDuplicates = user.messageHistory.filter(msg => msg === messageContent &&
            user.recentMessages.some(timestamp => timestamp > now - this.config.duplicateTimeWindow));
        if (recentDuplicates.length >= this.config.duplicateMessageThreshold - 1) { // -1 because this message would be the nth duplicate
            return this.handleSpam(user, `duplicate message spam detected (${recentDuplicates.length + 1} identical messages)`);
        }
        // Message is allowed - record it
        user.recentMessages.push(now);
        user.messageHistory.push(messageContent);
        user.lastMessage = now;
        user.messageCount++;
        return null; // Message allowed
    }
    /**
     * Handle rate limit violation
     */
    handleRateLimit(user, reason) {
        user.warningCount++;
        const now = Date.now();
        logger_1.logger.warn(`Rate limit violation for ${user.username} (${user.userId}): ${reason} (warning ${user.warningCount})`);
        // Progressive penalties
        if (user.warningCount >= 3) {
            // Block user after 3 warnings
            user.isBlocked = true;
            user.blockedUntil = now + (this.config.spamCooldownMinutes * 60 * 1000);
            logger_1.logger.warn(`User ${user.username} (${user.userId}) blocked for ${this.config.spamCooldownMinutes} minutes due to repeated rate limit violations`);
            return `User blocked for ${this.config.spamCooldownMinutes} minutes due to repeated rate limit violations`;
        }
        else {
            // Temporary cooldown
            user.blockedUntil = now + (this.config.rateLimitCooldownSeconds * 1000);
            user.lastWarning = now;
            return `Rate limit exceeded: ${reason}. Please wait ${this.config.rateLimitCooldownSeconds} seconds before sending another message.`;
        }
    }
    /**
     * Handle spam detection
     */
    handleSpam(user, reason) {
        const now = Date.now();
        logger_1.logger.warn(`Spam detected for ${user.username} (${user.userId}): ${reason}`);
        // Immediate block for spam
        user.isBlocked = true;
        user.blockedUntil = now + (this.config.spamCooldownMinutes * 60 * 1000);
        user.warningCount += 2; // Spam is more serious than rate limiting
        return `Spam detected: ${reason}. User blocked for ${this.config.spamCooldownMinutes} minutes.`;
    }
    /**
     * Get statistics about rate limiting
     */
    getStats() {
        const now = Date.now();
        const hourAgo = now - 60 * 60 * 1000;
        const dayAgo = now - 24 * 60 * 60 * 1000;
        let blockedUsers = 0;
        let totalMessages = 0;
        let recentWarnings = 0;
        let activeUsers = 0;
        for (const user of this.userActivity.values()) {
            if (user.isBlocked && now < user.blockedUntil) {
                blockedUsers++;
            }
            totalMessages += user.messageCount;
            if (user.lastWarning > dayAgo) {
                recentWarnings++;
            }
            if (user.lastMessage > hourAgo) {
                activeUsers++;
            }
        }
        return {
            totalUsers: this.userActivity.size,
            blockedUsers,
            totalMessages,
            recentWarnings,
            activeUsers
        };
    }
    /**
     * Get user-specific information
     */
    getUserInfo(userId) {
        return this.userActivity.get(userId) || null;
    }
    /**
     * Manually unblock a user (admin function)
     */
    unblockUser(userId) {
        const user = this.userActivity.get(userId);
        if (user && user.isBlocked) {
            user.isBlocked = false;
            user.blockedUntil = 0;
            user.warningCount = Math.max(0, user.warningCount - 1); // Reduce warning count
            logger_1.logger.info(`User ${user.username} (${userId}) manually unblocked`);
            return true;
        }
        return false;
    }
    /**
     * Clear all warnings for a user (admin function)
     */
    clearWarnings(userId) {
        const user = this.userActivity.get(userId);
        if (user) {
            user.warningCount = 0;
            user.lastWarning = 0;
            logger_1.logger.info(`Warnings cleared for user ${user.username} (${userId})`);
            return true;
        }
        return false;
    }
    /**
     * Get list of currently blocked users
     */
    getBlockedUsers() {
        const now = Date.now();
        return Array.from(this.userActivity.values())
            .filter(user => user.isBlocked && now < user.blockedUntil);
    }
    /**
     * Clean up old user activity to prevent memory leaks
     * Note: LRU cache already handles automatic eviction via TTL,
     * but this provides additional cleanup for inactive/unblocked users
     */
    cleanupOldActivity() {
        const now = Date.now();
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
        let cleanedCount = 0;
        // LRU cache iteration uses forEach instead of entries()
        this.userActivity.forEach((user, userId) => {
            // Remove users who haven't been active for a week and aren't blocked
            if (user.lastMessage < oneWeekAgo && (!user.isBlocked || now >= user.blockedUntil)) {
                this.userActivity.delete(userId);
                cleanedCount++;
            }
        });
        if (cleanedCount > 0) {
            logger_1.logger.debug(`Cleaned up ${cleanedCount} inactive user records`);
        }
    }
    /**
     * Update rate limit configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger_1.logger.info('Rate limiter configuration updated:', newConfig);
    }
    /**
     * Reset all user activity (admin function - use with caution)
     */
    resetAllUsers() {
        const userCount = this.userActivity.size;
        this.userActivity.clear();
        logger_1.logger.warn(`All user activity reset (${userCount} users cleared)`);
    }
    /**
     * Cleanup when shutting down
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        logger_1.logger.info('Rate limiter destroyed');
    }
}
exports.RateLimiter = RateLimiter;
