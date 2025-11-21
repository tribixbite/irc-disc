"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MentionDetector = void 0;
const logger_1 = require("./logger");
class MentionDetector {
    config;
    constructor(config = {}) {
        this.config = {
            enabled: true,
            caseSensitive: false,
            requireWordBoundary: true,
            allowPartialMatches: false,
            excludePrefixes: ['@', ':', '/', '#'],
            excludeSuffixes: [':', ',', '.', '!', '?'],
            maxLength: 32,
            ...config
        };
        logger_1.logger.debug('Mention detector initialized with config:', this.config);
    }
    /**
     * Detect and convert mentions in IRC message text for Discord
     */
    detectMentions(text, guild, ircAuthor, availableMembers) {
        if (!this.config.enabled) {
            return {
                originalText: text,
                textWithMentions: text,
                mentionedUsers: [],
                mentionedUsernames: []
            };
        }
        // Get all guild members or use provided subset
        const members = availableMembers || Array.from(guild.members.cache.values());
        let processedText = text;
        const mentionedUsers = [];
        const mentionedUsernames = [];
        // Sort members by username length (longest first) to prefer exact matches
        const sortedMembers = members.sort((a, b) => b.user.username.length - a.user.username.length);
        for (const member of sortedMembers) {
            const username = member.user.username;
            const displayName = member.displayName;
            // Skip if user is the same as IRC author (anti-self-ping protection)
            if (this.isSameUser(username, ircAuthor) || this.isSameUser(displayName, ircAuthor)) {
                logger_1.logger.debug(`Skipping mention for ${username}/${displayName} - same as IRC author ${ircAuthor}`);
                continue;
            }
            // Try to find mentions for both username and display name
            const usernameMention = this.findAndReplaceMention(processedText, username, member);
            if (usernameMention.found) {
                processedText = usernameMention.text;
                if (!mentionedUsers.includes(member)) {
                    mentionedUsers.push(member);
                    mentionedUsernames.push(username);
                }
            }
            // Only check display name if it's different from username
            if (displayName !== username) {
                const displayNameMention = this.findAndReplaceMention(processedText, displayName, member);
                if (displayNameMention.found) {
                    processedText = displayNameMention.text;
                    if (!mentionedUsers.includes(member)) {
                        mentionedUsers.push(member);
                        mentionedUsernames.push(displayName);
                    }
                }
            }
        }
        logger_1.logger.debug('Mention detection results:', {
            original: text,
            processed: processedText,
            mentionedCount: mentionedUsers.length,
            usernames: mentionedUsernames
        });
        return {
            originalText: text,
            textWithMentions: processedText,
            mentionedUsers,
            mentionedUsernames
        };
    }
    /**
     * Find and replace a specific username mention in text
     */
    findAndReplaceMention(text, username, member) {
        if (username.length > this.config.maxLength) {
            return { found: false, text };
        }
        // Create regex pattern based on configuration
        let pattern;
        if (this.config.requireWordBoundary) {
            // Word boundary approach - username must be separate word
            pattern = `\\b${this.escapeRegex(username)}\\b`;
        }
        else if (this.config.allowPartialMatches) {
            // Partial match approach - username can be part of another word
            pattern = this.escapeRegex(username);
        }
        else {
            // Exact match with optional surrounding punctuation
            pattern = `(?:^|\\s)${this.escapeRegex(username)}(?=\\s|$|[.,!?;:])`;
        }
        const flags = this.config.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(pattern, flags);
        let newText = text;
        let found = false;
        // Check if we find the pattern and it's not excluded by prefix/suffix rules
        const matches = Array.from(text.matchAll(regex));
        for (const match of matches) {
            const matchStart = match.index ?? 0;
            const matchEnd = matchStart + match[0].length;
            // Check for excluded prefixes/suffixes
            if (this.hasExcludedContext(text, matchStart, matchEnd, username)) {
                continue;
            }
            // Replace the match with Discord mention
            const beforeMatch = text.substring(0, matchStart);
            const afterMatch = text.substring(matchEnd);
            const matchedText = match[0];
            // Preserve any leading/trailing whitespace or punctuation
            const leadingSpace = matchedText.match(/^(\s*)/)?.[1] || '';
            const trailingSpace = matchedText.match(/(\s*)$/)?.[1] || '';
            newText = `${beforeMatch}${leadingSpace}${member.toString()}${trailingSpace}${afterMatch}`;
            found = true;
            break; // Only replace first occurrence to avoid double-mentions
        }
        return { found, text: newText };
    }
    /**
     * Check if a mention has excluded prefix or suffix context
     */
    hasExcludedContext(text, matchStart, matchEnd, username) {
        // Check for excluded prefixes
        for (const prefix of this.config.excludePrefixes) {
            if (matchStart >= prefix.length) {
                const beforeText = text.substring(matchStart - prefix.length, matchStart);
                if (beforeText === prefix) {
                    logger_1.logger.debug(`Excluding mention of ${username} due to prefix: ${prefix}`);
                    return true;
                }
            }
        }
        // Check for excluded suffixes
        for (const suffix of this.config.excludeSuffixes) {
            if (matchEnd + suffix.length <= text.length) {
                const afterText = text.substring(matchEnd, matchEnd + suffix.length);
                if (afterText === suffix) {
                    logger_1.logger.debug(`Excluding mention of ${username} due to suffix: ${suffix}`);
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Check if two usernames refer to the same user (case-insensitive by default)
     */
    isSameUser(username1, username2) {
        if (this.config.caseSensitive) {
            return username1 === username2;
        }
        return username1.toLowerCase() === username2.toLowerCase();
    }
    /**
     * Escape special regex characters in username
     */
    escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    /**
     * Update mention detection configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger_1.logger.info('Mention detector configuration updated:', newConfig);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Check if mention detection would trigger for a given username in text
     */
    wouldMention(text, username, ircAuthor) {
        if (!this.config.enabled)
            return false;
        if (this.isSameUser(username, ircAuthor))
            return false;
        const pattern = this.config.requireWordBoundary
            ? `\\b${this.escapeRegex(username)}\\b`
            : this.escapeRegex(username);
        const flags = this.config.caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(pattern, flags);
        const matches = Array.from(text.matchAll(regex));
        for (const match of matches) {
            const matchStart = match.index ?? 0;
            const matchEnd = matchStart + match[0].length;
            if (!this.hasExcludedContext(text, matchStart, matchEnd, username)) {
                return true;
            }
        }
        return false;
    }
}
exports.MentionDetector = MentionDetector;
