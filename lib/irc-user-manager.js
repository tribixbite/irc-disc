"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IRCUserManager = void 0;
const logger_1 = require("./logger");
const response_aware_whois_queue_1 = require("./irc/response-aware-whois-queue");
class IRCUserManager {
    users = new Map();
    channels = new Map();
    serverInfo;
    ircClient;
    userInfoRequests = new Map();
    pendingWhoisRequests = new Set();
    pendingWhoRequests = new Map();
    pendingListRequests = new Map();
    whoisQueue;
    enableWhois;
    constructor(ircClient, config = {}) {
        this.ircClient = ircClient;
        this.enableWhois = config.enableWhois ?? false; // Disabled by default to prevent spam
        this.whoisQueue = new response_aware_whois_queue_1.ResponseAwareWhoisQueue(ircClient, config.whoisTimeout ?? 5000);
        this.serverInfo = {
            name: '',
            supportedFeatures: new Map(),
            motd: [],
            userModes: [],
            channelModes: [],
            prefixes: new Map([
                ['@', 'o'], // operator
                ['+', 'v'], // voice
                ['%', 'h'], // halfop
                ['&', 'a'], // admin
                ['~', 'q'], // owner
            ])
        };
        this.setupEventHandlers();
        logger_1.logger.info(`IRC User Manager initialized (WHOIS ${this.enableWhois ? 'enabled' : 'disabled'})`);
    }
    setupEventHandlers() {
        // Handle server capabilities and features
        this.ircClient.on('raw', (message) => {
            this.handleRawMessage(message);
        });
        // Handle user joins
        this.ircClient.on('join', (channelName, nick) => {
            this.handleUserJoin(channelName, nick);
        });
        // Handle user parts
        this.ircClient.on('part', (channelName, nick) => {
            this.handleUserPart(channelName, nick);
        });
        // Handle user quits
        this.ircClient.on('quit', (nick, _reason, _channels) => {
            this.handleUserQuit(nick);
        });
        // Handle nick changes
        this.ircClient.on('nick', (oldNick, newNick) => {
            this.handleNickChange(oldNick, newNick);
        });
        // Handle names response (user list for channel)
        this.ircClient.on('names', (channelName, nicks) => {
            this.handleNamesResponse(channelName, nicks);
        });
        // Handle channel topic
        this.ircClient.on('topic', (channelName, topic, nick) => {
            this.handleTopicChange(channelName, topic, nick);
        });
        // Handle mode changes
        this.ircClient.on('mode', (channelName, by, mode, argument, adding) => {
            this.handleModeChange(channelName, by, mode, argument, adding);
        });
    }
    handleRawMessage(message) {
        const command = message.command;
        const params = message.args || [];
        switch (command) {
            case '005': // RPL_ISUPPORT - Server capabilities
                this.parseServerCapabilities(params);
                break;
            case '311': // RPL_WHOISUSER
                this.parseWhoisUser(params);
                break;
            case '312': // RPL_WHOISSERVER
                this.parseWhoisServer(params);
                break;
            case '313': // RPL_WHOISOPERATOR
                this.parseWhoisOperator(params);
                break;
            case '317': // RPL_WHOISIDLE
                this.parseWhoisIdle(params);
                break;
            case '319': // RPL_WHOISCHANNELS
                this.parseWhoisChannels(params);
                break;
            case '330': // RPL_WHOISACCOUNT (services account)
                this.parseWhoisAccount(params);
                break;
            case '671': // RPL_WHOISSECURE (SSL connection)
                this.parseWhoisSecure(params);
                break;
            case '318': // RPL_ENDOFWHOIS
                this.handleEndOfWhois(params);
                break;
            case '353': // RPL_NAMREPLY - Names list
                this.parseNamesReply(params);
                break;
            case '366': // RPL_ENDOFNAMES
                // Names list complete
                break;
            case '367': // RPL_BANLIST
                this.parseBanList(params);
                break;
            case '352': // RPL_WHOREPLY
                this.parseWhoReply(params);
                break;
            case '315': // RPL_ENDOFWHO
                this.handleEndOfWho(params);
                break;
            case '322': // RPL_LIST
                this.parseListReply(params);
                break;
            case '323': // RPL_LISTEND
                this.handleEndOfList();
                break;
            case '001': // RPL_WELCOME
                this.serverInfo.name = message.server || '';
                break;
        }
    }
    parseServerCapabilities(params) {
        for (const param of params.slice(1)) { // Skip the nick parameter
            if (param.includes('=')) {
                const [key, value] = param.split('=', 2);
                this.serverInfo.supportedFeatures.set(key, value);
            }
            else {
                this.serverInfo.supportedFeatures.set(param, true);
            }
        }
        // Parse PREFIX for mode symbols
        const prefixParam = this.serverInfo.supportedFeatures.get('PREFIX');
        if (prefixParam) {
            const match = prefixParam.match(/\(([^)]+)\)(.*)/);
            if (match) {
                const modes = match[1];
                const symbols = match[2];
                this.serverInfo.prefixes.clear();
                for (let i = 0; i < modes.length && i < symbols.length; i++) {
                    this.serverInfo.prefixes.set(symbols[i], modes[i]);
                }
            }
        }
        // Parse CHANMODES
        const chanmodesParam = this.serverInfo.supportedFeatures.get('CHANMODES');
        if (chanmodesParam) {
            this.serverInfo.channelModes = chanmodesParam.split(',').flat();
        }
    }
    parseWhoisUser(params) {
        if (params.length < 6)
            return;
        const [, nick, username, hostname, , realname] = params;
        let user = this.users.get(nick.toLowerCase());
        if (!user) {
            user = this.createUserInfo(nick);
            this.users.set(nick.toLowerCase(), user);
        }
        user.username = username;
        user.hostname = hostname;
        user.realname = realname;
        user.lastSeen = Date.now();
        logger_1.logger.debug(`Updated user info for ${nick}:`, { username, hostname, realname });
    }
    parseWhoisServer(params) {
        if (params.length < 4)
            return;
        const [, nick, server] = params;
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.server = server;
        }
    }
    parseWhoisOperator(params) {
        if (params.length < 2)
            return;
        const [, nick] = params;
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.isOperator = true;
        }
    }
    parseWhoisIdle(params) {
        if (params.length < 4)
            return;
        const [, nick, idleTimeStr, signonTimeStr] = params;
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.idleTime = parseInt(idleTimeStr, 10);
            user.signonTime = parseInt(signonTimeStr, 10) * 1000; // Convert to milliseconds
        }
    }
    parseWhoisChannels(params) {
        if (params.length < 3)
            return;
        const [, nick, channelsStr] = params;
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            // Parse channels with modes like "@#channel +#anotherchannel"
            const channels = channelsStr.split(' ').map(ch => {
                const trimmed = ch.trim();
                return trimmed.replace(/^[@+%&~]/, ''); // Remove mode prefixes
            }).filter(ch => ch.length > 0);
            user.channels = channels;
        }
    }
    parseWhoisAccount(params) {
        if (params.length < 4)
            return;
        const [, nick, account] = params;
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.account = account;
        }
    }
    parseWhoisSecure(params) {
        if (params.length < 2)
            return;
        const [, nick] = params;
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.isSecure = true;
        }
    }
    handleEndOfWhois(params) {
        if (params.length < 2)
            return;
        const [, nick] = params;
        this.pendingWhoisRequests.delete(nick.toLowerCase());
        logger_1.logger.debug(`Completed WHOIS for ${nick}`);
    }
    parseNamesReply(params) {
        if (params.length < 4)
            return;
        const [, , channelName, namesStr] = params;
        this.handleNamesResponse(channelName, this.parseNamesString(namesStr));
    }
    parseNamesString(namesStr) {
        const result = {};
        const names = namesStr.split(' ').filter(name => name.trim());
        for (const name of names) {
            const trimmed = name.trim();
            if (trimmed) {
                // Extract mode prefix and nick
                const modeMatch = trimmed.match(/^([@+%&~]*)(.+)$/);
                if (modeMatch) {
                    const [, modes, nick] = modeMatch;
                    result[nick] = modes || '';
                }
            }
        }
        return result;
    }
    parseBanList(params) {
        // Handle ban list if needed for comprehensive channel info
        if (params.length < 4)
            return;
        // Implementation can be added if ban list tracking is needed
    }
    parseWhoReply(params) {
        // WHO reply format: nick channel username host server nick flags :realname
        if (params.length < 8)
            return;
        const [, , username, hostname, server, nick, flags, ...realnameArray] = params;
        const realname = realnameArray.join(' ').replace(/^:/, '');
        let user = this.users.get(nick.toLowerCase());
        if (!user) {
            user = this.createUserInfo(nick);
            this.users.set(nick.toLowerCase(), user);
        }
        // Update user info from WHO reply
        user.username = username;
        user.hostname = hostname;
        user.server = server;
        user.realname = realname;
        user.lastSeen = Date.now();
        // Parse flags: H=here, G=away, *=oper, @=chanop, +=voice
        user.isAway = flags.includes('G');
        user.isOperator = flags.includes('*');
        // Add to any pending WHO requests
        for (const [, request] of this.pendingWhoRequests.entries()) {
            if (!request.users.find(u => u.nick.toLowerCase() === nick.toLowerCase())) {
                request.users.push({ ...user });
            }
        }
        logger_1.logger.debug(`Updated user info from WHO: ${nick}`, { username, hostname, server });
    }
    handleEndOfWho(params) {
        if (params.length < 3)
            return;
        const [, target] = params;
        // Resolve any pending WHO requests for this target
        const request = this.pendingWhoRequests.get(target);
        if (request) {
            clearTimeout(request.timeout);
            request.resolve(request.users);
            this.pendingWhoRequests.delete(target);
            logger_1.logger.debug(`Completed WHO request for ${target}, found ${request.users.length} users`);
        }
    }
    parseListReply(params) {
        // LIST reply format: channel user_count :topic
        if (params.length < 4)
            return;
        const [, channelName, userCountStr, ...topicArray] = params;
        const topic = topicArray.join(' ').replace(/^:/, '');
        const userCount = parseInt(userCountStr, 10) || 0;
        const listItem = {
            name: channelName,
            userCount,
            topic: topic || undefined
        };
        // Add to any pending LIST requests (with safety limit)
        for (const [, request] of this.pendingListRequests.entries()) {
            if (request.channels.length < request.maxChannels) {
                request.channels.push(listItem);
            }
            else if (request.channels.length === request.maxChannels) {
                logger_1.logger.warn(`LIST request reached maximum channel limit of ${request.maxChannels}. Further channels will be ignored.`);
            }
        }
        logger_1.logger.debug(`Added channel to LIST: ${channelName} (${userCount} users)`);
    }
    handleEndOfList() {
        // Resolve all pending LIST requests
        for (const [requestId, request] of this.pendingListRequests.entries()) {
            clearTimeout(request.timeout);
            request.resolve(request.channels);
            this.pendingListRequests.delete(requestId);
            logger_1.logger.debug(`Completed LIST request, found ${request.channels.length} channels`);
        }
    }
    handleUserJoin(channelName, nick) {
        // Update user info
        let user = this.users.get(nick.toLowerCase());
        if (!user) {
            user = this.createUserInfo(nick);
            this.users.set(nick.toLowerCase(), user);
        }
        if (!user.channels.includes(channelName)) {
            user.channels.push(channelName);
        }
        user.lastSeen = Date.now();
        // Update channel info
        let channel = this.channels.get(channelName.toLowerCase());
        if (!channel) {
            channel = this.createChannelInfo(channelName);
            this.channels.set(channelName.toLowerCase(), channel);
        }
        channel.users.set(nick.toLowerCase(), {
            nick,
            modes: [],
            isOperator: false,
            isVoiced: false,
            isHalfOperator: false,
            joinTime: Date.now()
        });
        channel.userCount = channel.users.size;
        // Request detailed user info if we don't have it
        this.requestUserInfo(nick);
    }
    handleUserPart(channelName, nick) {
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.channels = user.channels.filter(ch => ch !== channelName);
            user.lastSeen = Date.now();
        }
        const channel = this.channels.get(channelName.toLowerCase());
        if (channel) {
            channel.users.delete(nick.toLowerCase());
            channel.userCount = channel.users.size;
        }
    }
    handleUserQuit(nick) {
        const user = this.users.get(nick.toLowerCase());
        if (user) {
            user.channels = [];
            user.lastSeen = Date.now();
        }
        // Remove from all channels
        for (const channel of this.channels.values()) {
            if (channel.users.delete(nick.toLowerCase())) {
                channel.userCount = channel.users.size;
            }
        }
    }
    handleNickChange(oldNick, newNick) {
        const user = this.users.get(oldNick.toLowerCase());
        if (user) {
            user.nick = newNick;
            user.lastSeen = Date.now();
            // Update the map key
            this.users.delete(oldNick.toLowerCase());
            this.users.set(newNick.toLowerCase(), user);
            // Update channel user maps
            for (const channel of this.channels.values()) {
                const channelUser = channel.users.get(oldNick.toLowerCase());
                if (channelUser) {
                    channelUser.nick = newNick;
                    channel.users.delete(oldNick.toLowerCase());
                    channel.users.set(newNick.toLowerCase(), channelUser);
                }
            }
        }
    }
    handleNamesResponse(channelName, nicks) {
        let channel = this.channels.get(channelName.toLowerCase());
        if (!channel) {
            channel = this.createChannelInfo(channelName);
            this.channels.set(channelName.toLowerCase(), channel);
        }
        // Clear existing users and rebuild
        channel.users.clear();
        for (const [nick, modes] of Object.entries(nicks)) {
            const channelUser = {
                nick,
                modes: modes.split(''),
                isOperator: modes.includes('@'),
                isVoiced: modes.includes('+'),
                isHalfOperator: modes.includes('%'),
                joinTime: Date.now() // We don't know the actual join time
            };
            channel.users.set(nick.toLowerCase(), channelUser);
            // Update or create user info
            let user = this.users.get(nick.toLowerCase());
            if (!user) {
                user = this.createUserInfo(nick);
                this.users.set(nick.toLowerCase(), user);
            }
            if (!user.channels.includes(channelName)) {
                user.channels.push(channelName);
            }
            user.lastSeen = Date.now();
            // Update user modes based on channel modes
            user.isOperator = user.isOperator || channelUser.isOperator;
            user.isVoiced = user.isVoiced || channelUser.isVoiced;
            // Request detailed info for users we don't know much about
            if (!user.hostname) {
                this.requestUserInfo(nick);
            }
        }
        channel.userCount = channel.users.size;
        logger_1.logger.debug(`Updated channel ${channelName} with ${channel.userCount} users`);
    }
    handleTopicChange(channelName, topic, nick) {
        let channel = this.channels.get(channelName.toLowerCase());
        if (!channel) {
            channel = this.createChannelInfo(channelName);
            this.channels.set(channelName.toLowerCase(), channel);
        }
        channel.topic = topic;
        channel.topicSetBy = nick;
        channel.topicSetAt = Date.now();
    }
    handleModeChange(channelName, by, mode, argument, adding) {
        const channel = this.channels.get(channelName.toLowerCase());
        if (!channel)
            return;
        // Handle user mode changes
        if (argument && channel.users.has(argument.toLowerCase())) {
            const channelUser = channel.users.get(argument.toLowerCase());
            if (adding) {
                if (!channelUser.modes.includes(mode)) {
                    channelUser.modes.push(mode);
                }
            }
            else {
                channelUser.modes = channelUser.modes.filter(m => m !== mode);
            }
            // Update convenience flags
            channelUser.isOperator = channelUser.modes.includes('@') || channelUser.modes.includes('o');
            channelUser.isVoiced = channelUser.modes.includes('+') || channelUser.modes.includes('v');
            channelUser.isHalfOperator = channelUser.modes.includes('%') || channelUser.modes.includes('h');
            // Update user's global info
            const user = this.users.get(argument.toLowerCase());
            if (user) {
                user.isOperator = user.isOperator || channelUser.isOperator;
                user.isVoiced = user.isVoiced || channelUser.isVoiced;
            }
        }
        // Handle channel mode changes
        if (adding) {
            if (!channel.modes.includes(mode)) {
                channel.modes.push(mode);
            }
        }
        else {
            channel.modes = channel.modes.filter(m => m !== mode);
        }
    }
    createUserInfo(nick) {
        return {
            nick,
            channels: [],
            modes: [],
            isOperator: false,
            isVoiced: false,
            isAway: false,
            lastSeen: Date.now(),
            isSecure: false
        };
    }
    createChannelInfo(name) {
        return {
            name,
            modes: [],
            userCount: 0,
            users: new Map()
        };
    }
    requestUserInfo(nick) {
        // Skip WHOIS requests if disabled in config
        if (!this.enableWhois) {
            return;
        }
        const key = nick.toLowerCase();
        // Avoid spamming WHOIS requests
        if (this.pendingWhoisRequests.has(key)) {
            return;
        }
        // Use the queue instead of direct whois() calls
        // The queue prevents flood kicks by rate-limiting and waiting for responses
        this.pendingWhoisRequests.add(key);
        this.whoisQueue.add(nick);
        logger_1.logger.debug(`Added ${nick} to WHOIS queue`);
    }
    // Public API methods
    /**
     * Get information about a specific user
     */
    getUserInfo(nick) {
        const user = this.users.get(nick.toLowerCase());
        if (user && (!user.hostname || Date.now() - user.lastSeen > 300000)) { // Refresh if stale (5 minutes)
            this.requestUserInfo(nick);
        }
        return user;
    }
    /**
     * Get all users in a channel
     */
    getChannelUsers(channelName) {
        const channel = this.channels.get(channelName.toLowerCase());
        return channel ? Array.from(channel.users.values()) : [];
    }
    /**
     * Get channel information
     */
    getChannelInfo(channelName) {
        return this.channels.get(channelName.toLowerCase());
    }
    /**
     * Get all tracked users
     */
    getAllUsers() {
        return Array.from(this.users.values());
    }
    /**
     * Get all tracked channels
     */
    getAllChannels() {
        return Array.from(this.channels.values());
    }
    /**
     * Search users by various criteria
     */
    searchUsers(query) {
        return this.getAllUsers().filter(user => {
            if (query.nick && !user.nick.toLowerCase().includes(query.nick.toLowerCase()))
                return false;
            if (query.hostname && (!user.hostname || !user.hostname.toLowerCase().includes(query.hostname.toLowerCase())))
                return false;
            if (query.realname && (!user.realname || !user.realname.toLowerCase().includes(query.realname.toLowerCase())))
                return false;
            if (query.channel && !user.channels.some(ch => ch.toLowerCase() === query.channel.toLowerCase()))
                return false;
            if (query.isOperator !== undefined && user.isOperator !== query.isOperator)
                return false;
            if (query.isSecure !== undefined && user.isSecure !== query.isSecure)
                return false;
            return true;
        });
    }
    /**
     * Get server information
     */
    getServerInfo() {
        return { ...this.serverInfo };
    }
    /**
     * Execute WHO command to find users matching a pattern
     */
    async whoQuery(pattern) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingWhoRequests.delete(pattern);
                reject(new Error(`WHO query timeout for pattern: ${pattern}`));
            }, 30000); // 30 second timeout
            this.pendingWhoRequests.set(pattern, {
                resolve,
                timeout,
                users: []
            });
            // Send WHO command
            this.ircClient.send('WHO', pattern);
            logger_1.logger.debug(`Sent WHO command for pattern: ${pattern}`);
        });
    }
    /**
     * Execute LIST command to discover channels
     */
    async listChannels(pattern) {
        return new Promise((resolve, reject) => {
            const requestId = `list_${Date.now()}_${Math.random()}`;
            const MAX_CHANNELS_TO_STORE = 10000; // Safety limit to prevent memory exhaustion
            const timeout = setTimeout(() => {
                this.pendingListRequests.delete(requestId);
                reject(new Error(`LIST query timeout${pattern ? ` for pattern: ${pattern}` : ''}`));
            }, 60000); // 60 second timeout (LIST can be slow)
            this.pendingListRequests.set(requestId, {
                resolve,
                timeout,
                channels: [],
                maxChannels: MAX_CHANNELS_TO_STORE
            });
            // Add a check to prevent unbounded LIST queries
            if (!pattern) {
                logger_1.logger.warn('Executing LIST command without a pattern. This can be memory-intensive on large networks.');
            }
            // Send LIST command
            if (pattern) {
                this.ircClient.send('LIST', pattern);
                logger_1.logger.debug(`Sent LIST command for pattern: ${pattern}`);
            }
            else {
                this.ircClient.send('LIST');
                logger_1.logger.debug('Sent LIST command for all channels');
            }
        });
    }
    /**
     * Force refresh user information
     */
    refreshUserInfo(nick) {
        this.requestUserInfo(nick);
    }
    /**
     * Get statistics
     */
    getStats() {
        const users = this.getAllUsers();
        return {
            totalUsers: users.length,
            totalChannels: this.channels.size,
            usersWithFullInfo: users.filter(u => u.hostname && u.username).length,
            operatorCount: users.filter(u => u.isOperator).length,
            secureUsers: users.filter(u => u.isSecure).length
        };
    }
    /**
     * Clean up stale user data
     */
    cleanup() {
        const now = Date.now();
        const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
        for (const [key, user] of this.users.entries()) {
            if (user.channels.length === 0 && now - user.lastSeen > staleThreshold) {
                this.users.delete(key);
            }
        }
        // Clear pending requests
        for (const timeout of this.userInfoRequests.values()) {
            clearTimeout(timeout);
        }
        this.userInfoRequests.clear();
        this.pendingWhoisRequests.clear();
        logger_1.logger.debug('Cleaned up stale user data');
    }
}
exports.IRCUserManager = IRCUserManager;
