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
  endpoint: z.string().url(),
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
  webhooks: z.record(z.string(), z.string().url()).optional(),

  // Formatting and behavior
  ircNickColor: z.boolean().optional(),
  ircStatusNotices: z.boolean().optional(),
  parallelPingFix: z.boolean().optional(),
  commandCharacters: z.array(z.string()).optional(),

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
