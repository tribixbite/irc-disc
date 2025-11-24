import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AWS SDK completely before importing module
vi.mock('@aws-sdk/client-s3', () => {
  const S3Client = vi.fn(() => ({
    send: vi.fn().mockResolvedValue({})
  }));
  return {
    S3Client,
    PutObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    HeadObjectCommand: vi.fn(),
    CopyObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn()
  };
});

// Mock presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://mock-signed-url.com')
}));

// Mock Logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}));

describe('S3Uploader Integration', () => {
  let S3Uploader: any;
  let uploader: any;

  const mockConfig = {
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    rateLimitConfig: {
      maxTokens: 1,
      windowMs: 60000, // 1 minute
      tokensPerWindow: 1
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to ensure mocks are applied
    const module = await import('../lib/s3-uploader.js');
    S3Uploader = module.S3Uploader;
    uploader = new S3Uploader(mockConfig);
  });

  it('should enforce rate limits', async () => {
    const buffer = Buffer.from('test');
    const userId = 'user123';

    // First upload should succeed
    const result1 = await uploader.uploadFile(userId, buffer, 'test1.txt');
    expect(result1.success).toBe(true);

    // Second upload should fail due to rate limit (maxTokens = 1)
    const result2 = await uploader.uploadFile(userId, buffer, 'test2.txt');
    expect(result2.success).toBe(false);
    expect(result2.error).toMatch(/Rate limit exceeded/);
  });

  it('should track limits per user', async () => {
    const buffer = Buffer.from('test');
    const user1 = 'userA';
    const user2 = 'userB';

    // User 1 uploads (consumes their token)
    const result1 = await uploader.uploadFile(user1, buffer, 'test1.txt');
    expect(result1.success).toBe(true);

    // User 2 uploads (has their own token)
    const result2 = await uploader.uploadFile(user2, buffer, 'test2.txt');
    expect(result2.success).toBe(true);
  });
});