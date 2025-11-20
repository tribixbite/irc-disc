/**
 * Token bucket rate limiter for S3 uploads
 *
 * Implements per-user rate limiting to prevent abuse and control S3 costs.
 * Uses token bucket algorithm for smooth rate limiting with burst capacity.
 */

export interface S3RateLimitConfig {
  /** Maximum number of tokens (uploads) in bucket */
  maxTokens: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Tokens refilled per window */
  tokensPerWindow: number;
}

interface UserBucket {
  tokens: number;
  lastRefill: number;
}

export class S3RateLimiter {
  private buckets: Map<string, UserBucket> = new Map();
  private config: S3RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new rate limiter
   * @param config Rate limit configuration
   */
  constructor(config: S3RateLimitConfig) {
    this.config = config;
    // Clean up old buckets every 30 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  /**
   * Check if user can perform action and consume token if allowed
   * @param userId User ID to check
   * @returns Object with allowed flag and retry time if denied
   */
  checkLimit(userId: string): { allowed: boolean; retryAfter?: number; remainingTokens?: number } {
    const now = Date.now();
    let bucket = this.buckets.get(userId);

    // Initialize bucket if doesn't exist
    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens - 1, // Consume one token immediately
        lastRefill: now
      };
      this.buckets.set(userId, bucket);
      return { allowed: true, remainingTokens: bucket.tokens };
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / this.config.windowMs) * this.config.tokensPerWindow;
    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + refillAmount);
    bucket.lastRefill = now;

    // Check if user has tokens available
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remainingTokens: Math.floor(bucket.tokens) };
    }

    // Calculate retry time
    const tokensNeeded = 1 - bucket.tokens;
    const timeToRefill = (tokensNeeded / this.config.tokensPerWindow) * this.config.windowMs;
    const retryAfter = Math.ceil(timeToRefill / 1000); // Convert to seconds

    return { allowed: false, retryAfter, remainingTokens: 0 };
  }

  /**
   * Reset rate limit for a specific user (admin override)
   * @param userId User ID to reset
   */
  resetUser(userId: string): void {
    this.buckets.delete(userId);
  }

  /**
   * Get current token count for user
   * @param userId User ID to check
   * @returns Current token count
   */
  getTokens(userId: string): number {
    const bucket = this.buckets.get(userId);
    if (!bucket) {
      return this.config.maxTokens;
    }

    // Calculate current tokens with refill
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / this.config.windowMs) * this.config.tokensPerWindow;
    return Math.min(this.config.maxTokens, Math.floor(bucket.tokens + refillAmount));
  }

  /**
   * Clean up old buckets (users inactive for >1 hour)
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [userId, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(userId);
      }
    }
  }

  /**
   * Destroy rate limiter and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }

  /**
   * Get current configuration
   */
  getConfig(): S3RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Get statistics
   */
  getStats(): { activeUsers: number; totalBuckets: number } {
    return {
      activeUsers: this.buckets.size,
      totalBuckets: this.buckets.size
    };
  }
}

/**
 * Create default rate limiter for S3 uploads
 * Default: 5 uploads per 10 minutes
 */
export function createDefaultS3RateLimiter(): S3RateLimiter {
  return new S3RateLimiter({
    maxTokens: 5,
    windowMs: 10 * 60 * 1000, // 10 minutes
    tokensPerWindow: 5
  });
}
