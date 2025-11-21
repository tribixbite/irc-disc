"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusNotificationManager = void 0;
const logger_1 = require("./logger");
class StatusNotificationManager {
    config;
    channels = new Map(); // guildId -> channels
    constructor(config = {}) {
        this.config = {
            enabled: true,
            useDedicatedChannels: true,
            fallbackToMainChannel: true,
            includeJoins: true,
            includeLeaves: true,
            includeQuits: true,
            includeKicks: true,
            includeTimeouts: true,
            includeBotEvents: false,
            includeIRCConnectionEvents: true, // Default to enabled for IRC health monitoring
            joinMessage: '*{nick}* has joined {channel}',
            leaveMessage: '*{nick}* has left {channel}',
            quitMessage: '*{nick}* has quit ({reason})',
            kickMessage: '*{nick}* was kicked from {channel} ({reason})',
            timeoutMessage: '*{nick}* was timed out in {channel} ({reason})',
            ircConnectedMessage: '✅ **IRC Connected** - Connection to IRC server established',
            ircDisconnectedMessage: '❌ **IRC Disconnected** - Connection to IRC server lost ({reason})',
            ircReconnectingMessage: '🔄 **IRC Reconnecting** - Attempting reconnection (attempt {attempt}/{maxAttempts})',
            ...config
        };
        logger_1.logger.info('Status notification manager initialized with config:', {
            enabled: this.config.enabled,
            useDedicatedChannels: this.config.useDedicatedChannels,
            joinLeaveChannelId: this.config.joinLeaveChannelId,
            timeoutChannelId: this.config.timeoutChannelId
        });
    }
    /**
     * Initialize dedicated channels for a guild
     */
    async initializeChannels(guild) {
        if (!this.config.enabled || !this.config.useDedicatedChannels) {
            return;
        }
        const channels = {};
        // Find join/leave channel
        if (this.config.joinLeaveChannelId) {
            try {
                const joinLeaveChannel = await guild.channels.fetch(this.config.joinLeaveChannelId);
                if (joinLeaveChannel?.isText()) {
                    channels.joinLeave = joinLeaveChannel;
                    logger_1.logger.info(`Found join/leave notification channel: ${joinLeaveChannel.name}`);
                }
            }
            catch (error) {
                logger_1.logger.warn(`Failed to find join/leave notification channel ${this.config.joinLeaveChannelId}:`, error);
            }
        }
        // Find timeout channel
        if (this.config.timeoutChannelId) {
            try {
                const timeoutChannel = await guild.channels.fetch(this.config.timeoutChannelId);
                if (timeoutChannel?.isText()) {
                    channels.timeout = timeoutChannel;
                    logger_1.logger.info(`Found timeout notification channel: ${timeoutChannel.name}`);
                }
            }
            catch (error) {
                logger_1.logger.warn(`Failed to find timeout notification channel ${this.config.timeoutChannelId}:`, error);
            }
        }
        this.channels.set(guild.id, channels);
    }
    /**
     * Send a join notification
     */
    async sendJoinNotification(nick, channelName, fallbackChannel, isBotEvent = false) {
        if (!this.config.enabled || !this.config.includeJoins) {
            return false;
        }
        if (isBotEvent && !this.config.includeBotEvents) {
            return false;
        }
        const message = this.formatMessage(this.config.joinMessage, {
            nick,
            channel: channelName,
            reason: ''
        });
        return await this.sendNotification(message, 'joinLeave', fallbackChannel);
    }
    /**
     * Send a leave notification
     */
    async sendLeaveNotification(nick, channelName, reason = '', fallbackChannel, isBotEvent = false) {
        if (!this.config.enabled || !this.config.includeLeaves) {
            return false;
        }
        if (isBotEvent && !this.config.includeBotEvents) {
            return false;
        }
        const message = this.formatMessage(this.config.leaveMessage, {
            nick,
            channel: channelName,
            reason
        });
        return await this.sendNotification(message, 'joinLeave', fallbackChannel);
    }
    /**
     * Send a quit notification
     */
    async sendQuitNotification(nick, reason = '', fallbackChannel, isBotEvent = false) {
        if (!this.config.enabled || !this.config.includeQuits) {
            return false;
        }
        if (isBotEvent && !this.config.includeBotEvents) {
            return false;
        }
        const message = this.formatMessage(this.config.quitMessage, {
            nick,
            channel: '',
            reason
        });
        return await this.sendNotification(message, 'joinLeave', fallbackChannel);
    }
    /**
     * Send a kick notification
     */
    async sendKickNotification(nick, channelName, reason = '', fallbackChannel) {
        if (!this.config.enabled || !this.config.includeKicks) {
            return false;
        }
        const message = this.formatMessage(this.config.kickMessage, {
            nick,
            channel: channelName,
            reason
        });
        return await this.sendNotification(message, 'timeout', fallbackChannel);
    }
    /**
     * Send a timeout notification
     */
    async sendTimeoutNotification(nick, channelName, reason = '', fallbackChannel) {
        if (!this.config.enabled || !this.config.includeTimeouts) {
            return false;
        }
        const message = this.formatMessage(this.config.timeoutMessage, {
            nick,
            channel: channelName,
            reason
        });
        return await this.sendNotification(message, 'timeout', fallbackChannel);
    }
    /**
     * Send IRC connection notification
     */
    async sendIRCConnectedNotification(fallbackChannel) {
        if (!this.config.enabled || !this.config.includeIRCConnectionEvents) {
            return false;
        }
        const message = this.config.ircConnectedMessage;
        return await this.sendNotification(message, 'joinLeave', fallbackChannel);
    }
    /**
     * Send IRC disconnection notification
     */
    async sendIRCDisconnectedNotification(reason = 'Unknown reason', fallbackChannel) {
        if (!this.config.enabled || !this.config.includeIRCConnectionEvents) {
            return false;
        }
        const message = this.config.ircDisconnectedMessage.replace(/{reason}/g, reason);
        return await this.sendNotification(message, 'joinLeave', fallbackChannel);
    }
    /**
     * Send IRC reconnecting notification
     */
    async sendIRCReconnectingNotification(attempt, maxAttempts, fallbackChannel) {
        if (!this.config.enabled || !this.config.includeIRCConnectionEvents) {
            return false;
        }
        const message = this.config.ircReconnectingMessage
            .replace(/{attempt}/g, attempt.toString())
            .replace(/{maxAttempts}/g, maxAttempts.toString());
        return await this.sendNotification(message, 'joinLeave', fallbackChannel);
    }
    /**
     * Send notification to appropriate channel
     */
    async sendNotification(message, channelType, fallbackChannel) {
        if (!this.config.useDedicatedChannels) {
            // Send to fallback channel if not using dedicated channels
            try {
                await fallbackChannel.send(message);
                logger_1.logger.debug(`Sent status notification to fallback channel: ${message}`);
                return true;
            }
            catch (error) {
                logger_1.logger.error('Failed to send status notification to fallback channel:', error);
                return false;
            }
        }
        const guildChannels = this.channels.get(fallbackChannel.guild.id);
        const targetChannel = guildChannels?.[channelType];
        if (targetChannel) {
            try {
                await targetChannel.send(message);
                logger_1.logger.debug(`Sent status notification to ${channelType} channel: ${message}`);
                return true;
            }
            catch (error) {
                logger_1.logger.error(`Failed to send status notification to ${channelType} channel:`, error);
                // Fall back to main channel if configured
                if (this.config.fallbackToMainChannel) {
                    try {
                        await fallbackChannel.send(message);
                        logger_1.logger.debug(`Sent status notification to fallback channel after error: ${message}`);
                        return true;
                    }
                    catch (fallbackError) {
                        logger_1.logger.error('Failed to send status notification to fallback channel:', fallbackError);
                    }
                }
                return false;
            }
        }
        else {
            // No dedicated channel found
            if (this.config.fallbackToMainChannel) {
                try {
                    await fallbackChannel.send(message);
                    logger_1.logger.debug(`Sent status notification to fallback channel (no dedicated): ${message}`);
                    return true;
                }
                catch (error) {
                    logger_1.logger.error('Failed to send status notification to fallback channel:', error);
                    return false;
                }
            }
            else {
                logger_1.logger.debug(`No ${channelType} channel configured and fallback disabled, skipping notification`);
                return false;
            }
        }
    }
    /**
     * Format message with placeholders
     */
    formatMessage(template, variables) {
        // Defensive check for undefined template
        if (!template) {
            return `*${variables.nick}*${variables.channel ? ` in ${variables.channel}` : ''}${variables.reason ? ` (${variables.reason})` : ''}`;
        }
        return template
            .replace(/{nick}/g, variables.nick)
            .replace(/{channel}/g, variables.channel)
            .replace(/{reason}/g, variables.reason)
            .replace(/\s*\(\)\s*/g, '') // Remove empty parentheses when reason is empty
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger_1.logger.info('Status notification configuration updated:', newConfig);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get configured channels for a guild
     */
    getChannels(guildId) {
        return this.channels.get(guildId);
    }
    /**
     * Check if notifications are enabled for a specific type
     */
    isNotificationEnabled(type) {
        if (!this.config.enabled)
            return false;
        switch (type) {
            case 'join': return this.config.includeJoins;
            case 'leave': return this.config.includeLeaves;
            case 'quit': return this.config.includeQuits;
            case 'kick': return this.config.includeKicks;
            case 'timeout': return this.config.includeTimeouts;
            case 'ircConnection': return this.config.includeIRCConnectionEvents;
            default: return false;
        }
    }
    /**
     * Load configuration from environment variables or config
     */
    static loadConfig(options = {}) {
        const statusNotifications = options.statusNotifications;
        return {
            enabled: statusNotifications?.enabled ?? (process.env.STATUS_NOTIFICATIONS_ENABLED !== 'false'),
            useDedicatedChannels: statusNotifications?.useDedicatedChannels ?? (process.env.STATUS_NOTIFICATIONS_USE_DEDICATED_CHANNELS !== 'false'),
            joinLeaveChannelId: statusNotifications?.joinLeaveChannelId || process.env.STATUS_NOTIFICATIONS_JOIN_LEAVE_CHANNEL_ID,
            timeoutChannelId: statusNotifications?.timeoutChannelId || process.env.STATUS_NOTIFICATIONS_TIMEOUT_CHANNEL_ID,
            fallbackToMainChannel: statusNotifications?.fallbackToMainChannel ?? (process.env.STATUS_NOTIFICATIONS_FALLBACK_TO_MAIN !== 'false'),
            includeJoins: statusNotifications?.includeJoins ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_JOINS !== 'false'),
            includeLeaves: statusNotifications?.includeLeaves ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_LEAVES !== 'false'),
            includeQuits: statusNotifications?.includeQuits ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_QUITS !== 'false'),
            includeKicks: statusNotifications?.includeKicks ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_KICKS !== 'false'),
            includeTimeouts: statusNotifications?.includeTimeouts ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_TIMEOUTS !== 'false'),
            includeBotEvents: statusNotifications?.includeBotEvents ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_BOT_EVENTS === 'true'),
            includeIRCConnectionEvents: statusNotifications?.includeIRCConnectionEvents ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_IRC_CONNECTION !== 'false'),
            joinMessage: statusNotifications?.joinMessage || process.env.STATUS_NOTIFICATIONS_JOIN_MESSAGE,
            leaveMessage: statusNotifications?.leaveMessage || process.env.STATUS_NOTIFICATIONS_LEAVE_MESSAGE,
            quitMessage: statusNotifications?.quitMessage || process.env.STATUS_NOTIFICATIONS_QUIT_MESSAGE,
            kickMessage: statusNotifications?.kickMessage || process.env.STATUS_NOTIFICATIONS_KICK_MESSAGE,
            timeoutMessage: statusNotifications?.timeoutMessage || process.env.STATUS_NOTIFICATIONS_TIMEOUT_MESSAGE,
            ircConnectedMessage: statusNotifications?.ircConnectedMessage || process.env.STATUS_NOTIFICATIONS_IRC_CONNECTED_MESSAGE,
            ircDisconnectedMessage: statusNotifications?.ircDisconnectedMessage || process.env.STATUS_NOTIFICATIONS_IRC_DISCONNECTED_MESSAGE,
            ircReconnectingMessage: statusNotifications?.ircReconnectingMessage || process.env.STATUS_NOTIFICATIONS_IRC_RECONNECTING_MESSAGE
        };
    }
}
exports.StatusNotificationManager = StatusNotificationManager;
