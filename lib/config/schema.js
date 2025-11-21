"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configSchema = void 0;
exports.validateConfig = validateConfig;
const zod_1 = require("zod");
/**
 * Comprehensive configuration schema for irc-disc
 *
 * This schema validates the entire configuration at startup to prevent
 * runtime crashes from undefined or invalid config properties.
 *
 * Breaking change in v1.1.0: Invalid configs will cause the bot to fail-fast
 * at startup instead of crashing unpredictably during runtime.
 */
/**
 * Check if a URL uses HTTPS (prevent MITM attacks)
 */
function isHttpsUrl(url) {
    return url.startsWith('https://');
}
/**
 * Basic check to reject obviously private/internal URLs
 * This prevents SSRF attacks via user-controlled URLs
 */
function isLikelySafeUrl(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        // Reject localhost/loopback
        if (hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname.startsWith('127.') ||
            hostname === '::1' ||
            hostname === '0.0.0.0') {
            return false;
        }
        // Reject common private IP ranges (basic check)
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        if (hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) {
            return false;
        }
        // Reject link-local addresses
        if (hostname.startsWith('169.254.')) {
            return false;
        }
        // Reject internal TLDs
        if (hostname.endsWith('.local') ||
            hostname.endsWith('.internal') ||
            hostname.endsWith('.localhost')) {
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
// Status notification configuration
const statusNotificationSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(true),
    useDedicatedChannels: zod_1.z.boolean().default(true),
    joinLeaveChannelId: zod_1.z.string().optional(),
    timeoutChannelId: zod_1.z.string().optional(),
    fallbackToMainChannel: zod_1.z.boolean().default(true),
    includeJoins: zod_1.z.boolean().default(true),
    includeLeaves: zod_1.z.boolean().default(true),
    includeQuits: zod_1.z.boolean().default(true),
    includeKicks: zod_1.z.boolean().default(true),
    includeTimeouts: zod_1.z.boolean().default(true),
    includeBotEvents: zod_1.z.boolean().default(false),
    includeIRCConnectionEvents: zod_1.z.boolean().default(true),
    joinMessage: zod_1.z.string().default('*{nick}* has joined {channel}'),
    leaveMessage: zod_1.z.string().default('*{nick}* has left {channel}'),
    quitMessage: zod_1.z.string().default('*{nick}* has quit ({reason})'),
    kickMessage: zod_1.z.string().default('*{nick}* was kicked from {channel} ({reason})'),
    timeoutMessage: zod_1.z.string().default('*{nick}* was timed out in {channel} ({reason})'),
    ircConnectedMessage: zod_1.z.string().default('✅ **IRC Connected** - Connection to IRC server established'),
    ircDisconnectedMessage: zod_1.z.string().default('❌ **IRC Disconnected** - Connection to IRC server lost ({reason})'),
    ircReconnectingMessage: zod_1.z.string().default('🔄 **IRC Reconnecting** - Attempting reconnection (attempt {attempt}/{maxAttempts})')
}).optional();
// S3 configuration
const s3Schema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(false),
    endpoint: zod_1.z.string().url().refine(isLikelySafeUrl, { message: 'S3 endpoint must be a public URL (not localhost or private IP)' }),
    bucket: zod_1.z.string().min(1),
    accessKeyId: zod_1.z.string().min(1),
    secretAccessKey: zod_1.z.string().min(1),
    region: zod_1.z.string().default('us-east-1')
}).optional();
// Rate limiting configuration
const rateLimitingSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(true),
    maxMessagesPerMinute: zod_1.z.number().int().positive().default(20),
    maxMessagesPerHour: zod_1.z.number().int().positive().default(300),
    duplicateMessageThreshold: zod_1.z.number().int().positive().default(3),
    duplicateTimeWindow: zod_1.z.number().int().positive().default(30000),
    burstLimit: zod_1.z.number().int().positive().default(5),
    burstWindow: zod_1.z.number().int().positive().default(10000),
    spamCooldownMinutes: zod_1.z.number().int().positive().default(5),
    rateLimitCooldownSeconds: zod_1.z.number().int().positive().default(30)
}).optional();
// Private messages configuration
const privateMessagesSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(false),
    channelId: zod_1.z.string().optional(),
    threadPrefix: zod_1.z.string().default('PM: '),
    autoArchive: zod_1.z.number().int().positive().default(60)
}).optional();
// Recovery manager configuration
const recoverySchema = zod_1.z.object({
    maxRetries: zod_1.z.number().int().positive().default(5),
    baseDelay: zod_1.z.number().int().positive().default(1000),
    maxDelay: zod_1.z.number().int().positive().default(60000),
    jitterRange: zod_1.z.number().min(0).max(1).default(0.2),
    healthCheckInterval: zod_1.z.number().int().positive().default(30000),
    circuitBreakerThreshold: zod_1.z.number().int().positive().default(3),
    circuitBreakerTimeout: zod_1.z.number().int().positive().default(300000)
}).optional();
// Metrics configuration
const metricsSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(false),
    port: zod_1.z.number().int().positive().default(3001),
    path: zod_1.z.string().default('/metrics')
}).optional();
// Main configuration schema
exports.configSchema = zod_1.z.object({
    // Required IRC settings
    nickname: zod_1.z.string().min(1),
    server: zod_1.z.string().min(1),
    port: zod_1.z.number().int().positive().optional(),
    secure: zod_1.z.boolean().optional(),
    password: zod_1.z.string().optional(),
    // SASL authentication
    sasl: zod_1.z.object({
        username: zod_1.z.string().min(1),
        password: zod_1.z.string().min(1)
    }).optional(),
    // IRC client options (passed to node-irc)
    ircOptions: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    // Auto-send commands on IRC connect (legacy support)
    autoSendCommands: zod_1.z.array(zod_1.z.array(zod_1.z.string())).optional(),
    // User ignore lists
    ignoreUsers: zod_1.z.object({
        irc: zod_1.z.array(zod_1.z.string()).optional(),
        discord: zod_1.z.array(zod_1.z.string()).optional(),
        discordIds: zod_1.z.array(zod_1.z.string()).optional()
    }).optional(),
    // Required Discord settings
    discordToken: zod_1.z.string().min(1),
    // Channel mapping (Discord channel ID/name -> IRC channel)
    channelMapping: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
    // Optional features
    statusNotifications: statusNotificationSchema,
    s3: s3Schema,
    rateLimiting: rateLimitingSchema,
    privateMessages: privateMessagesSchema,
    recovery: recoverySchema,
    metrics: metricsSchema,
    webhooks: zod_1.z.record(zod_1.z.string(), zod_1.z.string().url()
        .refine(isHttpsUrl, { message: 'Webhook URLs must use HTTPS' })
        .refine(isLikelySafeUrl, { message: 'Webhook URLs must be public (not localhost or private IP)' })).optional(),
    // Message formatting templates
    format: zod_1.z.object({
        ircText: zod_1.z.string().optional(),
        urlAttachment: zod_1.z.string().optional(),
        discord: zod_1.z.string().optional(),
        commandPrelude: zod_1.z.union([zod_1.z.string(), zod_1.z.boolean()]).optional(),
        webhookAvatarURL: zod_1.z.string().optional()
    }).optional(),
    // Formatting and behavior
    ircNickColor: zod_1.z.boolean().optional(),
    ircNickColors: zod_1.z.array(zod_1.z.string()).optional(),
    ircStatusNotices: zod_1.z.boolean().optional(),
    announceSelfJoin: zod_1.z.boolean().optional(),
    parallelPingFix: zod_1.z.boolean().optional(),
    commandCharacters: zod_1.z.array(zod_1.z.string()).optional(),
    // Persistence
    dbPath: zod_1.z.string().optional(),
    dbCleanupPMThreadDays: zod_1.z.number().min(1).max(365).optional(), // Days to keep inactive PM threads (default: 7)
    dbCleanupChannelUsersDays: zod_1.z.number().min(0.001).max(365).optional(), // Days to keep channel user data (default: 1)
    // Logging
    logLevel: zod_1.z.enum(['error', 'warn', 'info', 'debug']).optional()
});
/**
 * Validate and parse a raw configuration object
 * @param rawConfig - Unvalidated configuration object
 * @returns Validated and typed configuration with all defaults applied
 * @throws ZodError if validation fails
 */
function validateConfig(rawConfig) {
    return exports.configSchema.parse(rawConfig);
}
