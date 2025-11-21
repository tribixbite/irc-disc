"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = void 0;
const logger_1 = require("./logger");
class MetricsCollector {
    metrics;
    persistence;
    saveInterval;
    hourlyResetInterval;
    // Sliding window for recent metrics (last hour)
    recentMessages = [];
    recentErrors = [];
    latencyWindow = [];
    constructor(persistence = null) {
        this.persistence = persistence;
        this.metrics = this.initializeMetrics();
        // Save metrics every 5 minutes
        this.saveInterval = setInterval(() => {
            void this.saveMetrics();
        }, 5 * 60 * 1000);
        // Clean up sliding windows every hour
        this.hourlyResetInterval = setInterval(() => {
            this.cleanupSlidingWindows();
        }, 60 * 60 * 1000);
        // Load existing metrics on startup (async, fire and forget)
        void this.loadMetrics();
        logger_1.logger.info('Metrics collector initialized');
    }
    initializeMetrics() {
        return {
            messagesDiscordToIRC: 0,
            messagesIRCToDiscord: 0,
            commandsProcessed: 0,
            attachmentsSent: 0,
            editsProcessed: 0,
            deletesProcessed: 0,
            messagesBlocked: 0,
            usersWarned: 0,
            usersBlocked: 0,
            spamDetected: 0,
            discordReconnects: 0,
            ircReconnects: 0,
            connectionErrors: 0,
            webhookErrors: 0,
            pmThreadsCreated: 0,
            pmMessagesExchanged: 0,
            pmThreadsArchived: 0,
            uniqueDiscordUsers: new Set(),
            uniqueIRCUsers: new Set(),
            peakConcurrentUsers: 0,
            messageLatencyMs: [],
            errorCount: 0,
            uptimeStart: Date.now(),
            ircConnected: false,
            ircLastConnected: 0,
            ircLastDisconnected: 0,
            ircConnectionUptime: 0,
            ircLastActivity: 0,
            channelActivity: new Map(),
            userActivity: new Map()
        };
    }
    /**
     * Record a message being sent from Discord to IRC
     */
    recordDiscordToIRC(userId, channel, latencyMs) {
        this.metrics.messagesDiscordToIRC++;
        this.metrics.uniqueDiscordUsers.add(userId);
        this.incrementChannelActivity(channel);
        this.incrementUserActivity(userId);
        this.addToRecentMessages();
        if (latencyMs !== undefined) {
            this.recordLatency(latencyMs);
        }
    }
    /**
     * Record a message being sent from IRC to Discord
     */
    recordIRCToDiscord(username, channel, latencyMs) {
        this.metrics.messagesIRCToDiscord++;
        this.metrics.uniqueIRCUsers.add(username);
        this.incrementChannelActivity(channel);
        this.incrementUserActivity(`irc:${username}`);
        this.addToRecentMessages();
        if (latencyMs !== undefined) {
            this.recordLatency(latencyMs);
        }
    }
    /**
     * Record a command being processed
     */
    recordCommand(isSlashCommand = false) {
        this.metrics.commandsProcessed++;
        if (isSlashCommand) {
            // Could track slash commands separately if needed
        }
    }
    /**
     * Record an attachment being sent
     */
    recordAttachment() {
        this.metrics.attachmentsSent++;
    }
    /**
     * Record message edit/delete events
     */
    recordEdit() {
        this.metrics.editsProcessed++;
    }
    recordDelete() {
        this.metrics.deletesProcessed++;
    }
    /**
     * Record rate limiting events
     */
    recordMessageBlocked() {
        this.metrics.messagesBlocked++;
    }
    recordUserWarned() {
        this.metrics.usersWarned++;
    }
    recordUserBlocked() {
        this.metrics.usersBlocked++;
    }
    recordSpamDetected() {
        this.metrics.spamDetected++;
    }
    /**
     * Record connection events
     */
    recordDiscordReconnect() {
        this.metrics.discordReconnects++;
    }
    recordIRCReconnect() {
        this.metrics.ircReconnects++;
    }
    recordConnectionError() {
        this.metrics.connectionErrors++;
        this.recordError();
    }
    recordWebhookError() {
        this.metrics.webhookErrors++;
        this.recordError();
    }
    /**
     * Record PM events
     */
    recordPMThreadCreated() {
        this.metrics.pmThreadsCreated++;
    }
    recordPMMessage() {
        this.metrics.pmMessagesExchanged++;
    }
    recordPMThreadArchived() {
        this.metrics.pmThreadsArchived++;
    }
    /**
     * Record general errors
     */
    recordError() {
        this.metrics.errorCount++;
        this.recentErrors.push(Date.now());
    }
    /**
     * Record successful recovery
     */
    recordSuccess() {
        // Could track successful operations if needed for metrics
        logger_1.logger.debug('Successful operation recorded');
    }
    /**
     * Record message processing latency
     */
    recordLatency(latencyMs) {
        this.latencyWindow.push(latencyMs);
        // Keep only last 1000 latency measurements
        if (this.latencyWindow.length > 1000) {
            this.latencyWindow = this.latencyWindow.slice(-1000);
        }
    }
    /**
     * Record IRC connection state change
     */
    recordIRCConnected() {
        const now = Date.now();
        // If we were disconnected, add the disconnected time to total uptime
        if (!this.metrics.ircConnected && this.metrics.ircLastConnected > 0) {
            const connectedDuration = this.metrics.ircLastDisconnected - this.metrics.ircLastConnected;
            if (connectedDuration > 0) {
                this.metrics.ircConnectionUptime += connectedDuration;
            }
        }
        this.metrics.ircConnected = true;
        this.metrics.ircLastConnected = now;
        this.metrics.ircLastActivity = now;
    }
    recordIRCDisconnected() {
        const now = Date.now();
        // If we were connected, add the connected time to total uptime
        if (this.metrics.ircConnected && this.metrics.ircLastConnected > 0) {
            const connectedDuration = now - this.metrics.ircLastConnected;
            if (connectedDuration > 0) {
                this.metrics.ircConnectionUptime += connectedDuration;
            }
        }
        this.metrics.ircConnected = false;
        this.metrics.ircLastDisconnected = now;
    }
    /**
     * Update IRC activity timestamp
     */
    updateIRCActivity() {
        this.metrics.ircLastActivity = Date.now();
    }
    /**
     * Get current IRC connection uptime (including current session if connected)
     */
    getIRCUptime() {
        let uptime = this.metrics.ircConnectionUptime;
        // Add current session time if connected
        if (this.metrics.ircConnected && this.metrics.ircLastConnected > 0) {
            uptime += (Date.now() - this.metrics.ircLastConnected);
        }
        return uptime;
    }
    /**
     * Get time since last IRC activity
     */
    getTimeSinceIRCActivity() {
        if (this.metrics.ircLastActivity === 0) {
            return 0;
        }
        return Date.now() - this.metrics.ircLastActivity;
    }
    /**
     * Update peak concurrent users
     */
    updatePeakUsers(currentUsers) {
        if (currentUsers > this.metrics.peakConcurrentUsers) {
            this.metrics.peakConcurrentUsers = currentUsers;
        }
    }
    /**
     * Get comprehensive metrics summary
     */
    getSummary() {
        const now = Date.now();
        const uptimeMs = now - this.metrics.uptimeStart;
        const uptimeHours = uptimeMs / (1000 * 60 * 60);
        const totalMessages = this.metrics.messagesDiscordToIRC + this.metrics.messagesIRCToDiscord;
        const messagesPerHour = uptimeHours > 0 ? totalMessages / uptimeHours : 0;
        const uniqueUsers = this.metrics.uniqueDiscordUsers.size + this.metrics.uniqueIRCUsers.size;
        // Calculate error rate (errors per 100 messages)
        const errorRate = totalMessages > 0 ? (this.metrics.errorCount / totalMessages) * 100 : 0;
        // Calculate average latency
        const averageLatency = this.latencyWindow.length > 0
            ? this.latencyWindow.reduce((sum, lat) => sum + lat, 0) / this.latencyWindow.length
            : 0;
        // Get top channels by activity
        const topChannels = Array.from(this.metrics.channelActivity.entries())
            .map(([channel, messages]) => ({ channel, messages }))
            .sort((a, b) => b.messages - a.messages)
            .slice(0, 10);
        // Get top users by activity
        const topUsers = Array.from(this.metrics.userActivity.entries())
            .map(([user, messages]) => ({ user, messages }))
            .sort((a, b) => b.messages - a.messages)
            .slice(0, 10);
        return {
            totalMessages,
            messagesPerHour,
            uniqueUsers,
            errorRate,
            averageLatency,
            uptime: uptimeMs,
            topChannels,
            topUsers
        };
    }
    /**
     * Get detailed metrics for admin viewing
     */
    getDetailedMetrics() {
        return {
            ...this.metrics,
            summary: this.getSummary()
        };
    }
    /**
     * Get recent activity (last hour)
     */
    getRecentActivity() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const messagesLastHour = this.recentMessages.filter(timestamp => timestamp > oneHourAgo).length;
        const errorsLastHour = this.recentErrors.filter(timestamp => timestamp > oneHourAgo).length;
        // Get latency for recent messages (last 100)
        const recentLatencies = this.latencyWindow.slice(-100);
        const averageLatencyLastHour = recentLatencies.length > 0
            ? recentLatencies.reduce((sum, lat) => sum + lat, 0) / recentLatencies.length
            : 0;
        return {
            messagesLastHour,
            errorsLastHour,
            averageLatencyLastHour
        };
    }
    /**
     * Reset all metrics (admin function)
     */
    resetMetrics() {
        logger_1.logger.warn('Metrics reset by admin command');
        this.metrics = this.initializeMetrics();
        this.recentMessages = [];
        this.recentErrors = [];
        this.latencyWindow = [];
        void this.saveMetrics();
    }
    /**
     * Export metrics for external monitoring systems
     */
    exportPrometheusMetrics() {
        const summary = this.getSummary();
        return `
# HELP discord_irc_messages_total Total number of messages processed
# TYPE discord_irc_messages_total counter
discord_irc_messages_total{direction="discord_to_irc"} ${this.metrics.messagesDiscordToIRC}
discord_irc_messages_total{direction="irc_to_discord"} ${this.metrics.messagesIRCToDiscord}

# HELP discord_irc_users_unique Total unique users seen
# TYPE discord_irc_users_unique gauge
discord_irc_users_unique{platform="discord"} ${this.metrics.uniqueDiscordUsers.size}
discord_irc_users_unique{platform="irc"} ${this.metrics.uniqueIRCUsers.size}

# HELP discord_irc_commands_total Total commands processed
# TYPE discord_irc_commands_total counter
discord_irc_commands_total ${this.metrics.commandsProcessed}

# HELP discord_irc_errors_total Total errors encountered
# TYPE discord_irc_errors_total counter
discord_irc_errors_total ${this.metrics.errorCount}

# HELP discord_irc_latency_seconds Message processing latency
# TYPE discord_irc_latency_seconds gauge
discord_irc_latency_seconds ${summary.averageLatency / 1000}

# HELP discord_irc_uptime_seconds Bot uptime in seconds
# TYPE discord_irc_uptime_seconds gauge
discord_irc_uptime_seconds ${summary.uptime / 1000}

# HELP discord_irc_rate_limit_blocks_total Messages blocked by rate limiting
# TYPE discord_irc_rate_limit_blocks_total counter
discord_irc_rate_limit_blocks_total ${this.metrics.messagesBlocked}

# HELP discord_irc_pm_threads_total Private message threads created
# TYPE discord_irc_pm_threads_total counter
discord_irc_pm_threads_total ${this.metrics.pmThreadsCreated}

# HELP discord_irc_connection_status IRC connection status (1=connected, 0=disconnected)
# TYPE discord_irc_connection_status gauge
discord_irc_connection_status ${this.metrics.ircConnected ? 1 : 0}

# HELP discord_irc_uptime_seconds Total IRC connection uptime in seconds
# TYPE discord_irc_uptime_seconds counter
discord_irc_uptime_seconds ${this.getIRCUptime() / 1000}

# HELP discord_irc_last_activity_seconds Time since last IRC activity in seconds
# TYPE discord_irc_last_activity_seconds gauge
discord_irc_last_activity_seconds ${this.getTimeSinceIRCActivity() / 1000}
`.trim();
    }
    incrementChannelActivity(channel) {
        const current = this.metrics.channelActivity.get(channel) || 0;
        this.metrics.channelActivity.set(channel, current + 1);
    }
    incrementUserActivity(user) {
        const current = this.metrics.userActivity.get(user) || 0;
        this.metrics.userActivity.set(user, current + 1);
    }
    addToRecentMessages() {
        this.recentMessages.push(Date.now());
        // Keep only last 24 hours of message timestamps
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        this.recentMessages = this.recentMessages.filter(timestamp => timestamp > oneDayAgo);
    }
    cleanupSlidingWindows() {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        // Clean up hourly windows
        this.recentErrors = this.recentErrors.filter(timestamp => timestamp > oneDayAgo);
        // Clean up daily windows
        this.recentMessages = this.recentMessages.filter(timestamp => timestamp > oneDayAgo);
        logger_1.logger.debug('Cleaned up metrics sliding windows');
    }
    async saveMetrics() {
        if (!this.persistence)
            return;
        try {
            // Save key metrics to persistence
            await this.persistence.saveMetric('total_messages', (this.metrics.messagesDiscordToIRC + this.metrics.messagesIRCToDiscord).toString());
            await this.persistence.saveMetric('unique_discord_users', this.metrics.uniqueDiscordUsers.size.toString());
            await this.persistence.saveMetric('unique_irc_users', this.metrics.uniqueIRCUsers.size.toString());
            await this.persistence.saveMetric('commands_processed', this.metrics.commandsProcessed.toString());
            await this.persistence.saveMetric('errors_total', this.metrics.errorCount.toString());
            await this.persistence.saveMetric('uptime_start', this.metrics.uptimeStart.toString());
            await this.persistence.saveMetric('pm_threads_created', this.metrics.pmThreadsCreated.toString());
            await this.persistence.saveMetric('messages_blocked', this.metrics.messagesBlocked.toString());
            logger_1.logger.debug('Metrics saved to persistence');
        }
        catch (error) {
            logger_1.logger.debug('Failed to save metrics (this is normal in test environment):', error);
        }
    }
    async loadMetrics() {
        if (!this.persistence)
            return;
        try {
            // Load key metrics from persistence
            const totalMessages = await this.persistence.getMetric('total_messages');
            const commands = await this.persistence.getMetric('commands_processed');
            const errors = await this.persistence.getMetric('errors_total');
            const uptime = await this.persistence.getMetric('uptime_start');
            const pmThreads = await this.persistence.getMetric('pm_threads_created');
            const blocked = await this.persistence.getMetric('messages_blocked');
            if (totalMessages) {
                // Estimate split between Discord->IRC and IRC->Discord (roughly 50/50)
                const total = parseInt(totalMessages);
                this.metrics.messagesDiscordToIRC = Math.floor(total / 2);
                this.metrics.messagesIRCToDiscord = total - this.metrics.messagesDiscordToIRC;
            }
            if (commands)
                this.metrics.commandsProcessed = parseInt(commands);
            if (errors)
                this.metrics.errorCount = parseInt(errors);
            if (uptime)
                this.metrics.uptimeStart = parseInt(uptime);
            if (pmThreads)
                this.metrics.pmThreadsCreated = parseInt(pmThreads);
            if (blocked)
                this.metrics.messagesBlocked = parseInt(blocked);
            logger_1.logger.info('Metrics loaded from persistence');
        }
        catch (error) {
            logger_1.logger.debug('Failed to load metrics from persistence (this is normal in test environment):', error);
        }
    }
    /**
     * Cleanup when shutting down
     */
    destroy() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        if (this.hourlyResetInterval) {
            clearInterval(this.hourlyResetInterval);
        }
        // Final save before shutdown
        void this.saveMetrics();
        logger_1.logger.info('Metrics collector destroyed');
    }
}
exports.MetricsCollector = MetricsCollector;
