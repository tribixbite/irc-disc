import { z } from 'zod';

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
function isHttpsUrl(url: string): boolean {
  return url.startsWith('https://');
}

/**
 * Basic check to reject obviously private/internal URLs
 * This prevents SSRF attacks via user-controlled URLs
 */
function isLikelySafeUrl(url: string): boolean {
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
  } catch {
    return false;
  }
}

// Status notification configuration
const statusNotificationSchema = z.object({
  enabled: z.boolean().default(true),
  useDedicatedChannels: z.boolean().default(true),
  joinLeaveChannelId: z.string().optional(),
  timeoutChannelId: z.string().optional(),
  fallbackToMainChannel: z.boolean().default(true),
  includeJoins: z.boolean().default(true),
  includeLeaves: z.boolean().default(true),
  includeQuits: z.boolean().default(true),
  includeKicks: z.boolean().default(true),
  includeTimeouts: z.boolean().default(true),
  includeBotEvents: z.boolean().default(false),
  joinMessage: z.string().default('*{nick}* has joined {channel}'),
  leaveMessage: z.string().default('*{nick}* has left {channel}'),
  quitMessage: z.string().default('*{nick}* has quit ({reason})'),
  kickMessage: z.string().default('*{nick}* was kicked from {channel} ({reason})'),
  timeoutMessage: z.string().default('*{nick}* was timed out in {channel} ({reason})')
}).optional();

// S3 configuration
const s3Schema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().url().refine(
    isLikelySafeUrl,
    { message: 'S3 endpoint must be a public URL (not localhost or private IP)' }
  ),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  region: z.string().default('us-east-1')
}).optional();

// Rate limiting configuration
const rateLimitingSchema = z.object({
  enabled: z.boolean().default(true),
  maxMessagesPerMinute: z.number().int().positive().default(20),
  maxMessagesPerHour: z.number().int().positive().default(300),
  duplicateMessageThreshold: z.number().int().positive().default(3),
  duplicateTimeWindow: z.number().int().positive().default(30000),
  burstLimit: z.number().int().positive().default(5),
  burstWindow: z.number().int().positive().default(10000),
  spamCooldownMinutes: z.number().int().positive().default(5),
  rateLimitCooldownSeconds: z.number().int().positive().default(30)
}).optional();

// Private messages configuration
const privateMessagesSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: z.string().optional(),
  threadPrefix: z.string().default('PM: '),
  autoArchive: z.number().int().positive().default(60)
}).optional();

// Recovery manager configuration
const recoverySchema = z.object({
  maxRetries: z.number().int().positive().default(5),
  baseDelay: z.number().int().positive().default(1000),
  maxDelay: z.number().int().positive().default(60000),
  jitterRange: z.number().min(0).max(1).default(0.2),
  healthCheckInterval: z.number().int().positive().default(30000),
  circuitBreakerThreshold: z.number().int().positive().default(3),
  circuitBreakerTimeout: z.number().int().positive().default(300000)
}).optional();

// Metrics configuration
const metricsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(3001),
  path: z.string().default('/metrics')
}).optional();

// Main configuration schema
export const configSchema = z.object({
  // Required IRC settings
  nickname: z.string().min(1),
  server: z.string().min(1),
  port: z.number().int().positive().optional(),
  secure: z.boolean().optional(),
  password: z.string().optional(),

  // SASL authentication
  sasl: z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  }).optional(),

  // IRC client options (passed to node-irc)
  ircOptions: z.record(z.string(), z.unknown()).optional(),

  // Auto-send commands on IRC connect (legacy support)
  autoSendCommands: z.array(z.array(z.string())).optional(),

  // User ignore lists
  ignoreUsers: z.object({
    irc: z.array(z.string()).optional(),
    discord: z.array(z.string()).optional(),
    discordIds: z.array(z.string()).optional()
  }).optional(),

  // Required Discord settings
  discordToken: z.string().min(1),

  // Channel mapping (Discord channel ID/name -> IRC channel)
  channelMapping: z.record(z.string(), z.string()),

  // Optional features
  statusNotifications: statusNotificationSchema,
  s3: s3Schema,
  rateLimiting: rateLimitingSchema,
  privateMessages: privateMessagesSchema,
  recovery: recoverySchema,
  metrics: metricsSchema,
  webhooks: z.record(
    z.string(),
    z.string().url()
      .refine(isHttpsUrl, { message: 'Webhook URLs must use HTTPS' })
      .refine(isLikelySafeUrl, { message: 'Webhook URLs must be public (not localhost or private IP)' })
  ).optional(),

  // Message formatting templates
  format: z.object({
    ircText: z.string().optional(),
    urlAttachment: z.string().optional(),
    discord: z.string().optional(),
    commandPrelude: z.union([z.string(), z.boolean()]).optional(),
    webhookAvatarURL: z.string().optional()
  }).optional(),

  // Formatting and behavior
  ircNickColor: z.boolean().optional(),
  ircNickColors: z.array(z.string()).optional(),
  ircStatusNotices: z.boolean().optional(),
  announceSelfJoin: z.boolean().optional(),
  parallelPingFix: z.boolean().optional(),
  commandCharacters: z.array(z.string()).optional(),

  // Persistence
  dbPath: z.string().optional(),

  // Logging
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).optional()
});

// Export the inferred TypeScript type
export type BotConfig = z.infer<typeof configSchema>;

/**
 * Validate and parse a raw configuration object
 * @param rawConfig - Unvalidated configuration object
 * @returns Validated and typed configuration with all defaults applied
 * @throws ZodError if validation fails
 */
export function validateConfig(rawConfig: unknown): BotConfig {
  return configSchema.parse(rawConfig);
}
