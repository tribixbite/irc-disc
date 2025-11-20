import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3RateLimiter, createDefaultS3RateLimiter } from '../lib/s3-rate-limiter';

describe('S3RateLimiter', () => {
  let limiter: S3RateLimiter;

  beforeEach(() => {
    limiter = new S3RateLimiter({
      maxTokens: 3,
      windowMs: 1000, // 1 second for testing
      tokensPerWindow: 3
    });
  });

  it('should allow requests within limit', () => {
    const result1 = limiter.checkLimit('user1');
    expect(result1.allowed).toBe(true);
    expect(result1.remainingTokens).toBe(2);

    const result2 = limiter.checkLimit('user1');
    expect(result2.allowed).toBe(true);
    expect(result2.remainingTokens).toBe(1);
  });

  it('should deny requests when limit exceeded', () => {
    // Use all tokens
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');

    // Should be denied
    const result = limiter.checkLimit('user1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.remainingTokens).toBe(0);
  });

  it('should track users independently', () => {
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');

    // user1 is rate limited
    expect(limiter.checkLimit('user1').allowed).toBe(false);

    // user2 should still have tokens
    expect(limiter.checkLimit('user2').allowed).toBe(true);
  });

  it('should refill tokens over time', async () => {
    // Use all tokens
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');

    // Should be denied immediately
    expect(limiter.checkLimit('user1').allowed).toBe(false);

    // Wait for refill (1 second window)
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Should allow again after refill
    const result = limiter.checkLimit('user1');
    expect(result.allowed).toBe(true);
  });

  it('should reset user limit', () => {
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');
    limiter.checkLimit('user1');

    // Should be denied
    expect(limiter.checkLimit('user1').allowed).toBe(false);

    // Reset
    limiter.resetUser('user1');

    // Should allow again
    expect(limiter.checkLimit('user1').allowed).toBe(true);
  });

  it('should get remaining tokens', () => {
    expect(limiter.getTokens('newuser')).toBe(3);

    limiter.checkLimit('user1');
    expect(limiter.getTokens('user1')).toBe(2);

    limiter.checkLimit('user1');
    expect(limiter.getTokens('user1')).toBe(1);
  });

  it('should return stats', () => {
    limiter.checkLimit('user1');
    limiter.checkLimit('user2');

    const stats = limiter.getStats();
    expect(stats.activeUsers).toBe(2);
    expect(stats.totalBuckets).toBe(2);
  });

  it('should clean up resources on destroy', () => {
    const spy = vi.spyOn(global, 'clearInterval');
    limiter.destroy();
    expect(spy).toHaveBeenCalled();
  });
});

describe('createDefaultS3RateLimiter', () => {
  it('should create limiter with correct defaults', () => {
    const limiter = createDefaultS3RateLimiter();
    const config = limiter.getConfig();

    expect(config.maxTokens).toBe(5);
    expect(config.windowMs).toBe(10 * 60 * 1000); // 10 minutes
    expect(config.tokensPerWindow).toBe(5);

    limiter.destroy();
  });
});
