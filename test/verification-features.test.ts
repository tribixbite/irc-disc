import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersistenceService } from '../lib/persistence';
import { S3Uploader } from '../lib/s3-uploader';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock logger to avoid noise
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('Feature Verification Suite', () => {
  
  describe('PM Persistence', () => {
    let persistence: PersistenceService;
    const dbPath = path.join(os.tmpdir(), `test-db-${Date.now()}.sqlite`);

    beforeEach(async () => {
      persistence = new PersistenceService(dbPath);
      await persistence.initialize();
    });

    afterEach(async () => {
      await persistence.close();
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    });

    it('should save and retrieve a PM thread', async () => {
      const ircNick = 'TestUser';
      const threadId = '123456789';
      const channelId = '987654321';

      await persistence.savePMThread(ircNick, threadId, channelId);
      
      const retrieved = await persistence.getPMThread(ircNick);
      expect(retrieved).toBeDefined();
      expect(retrieved?.ircNick).toBe(ircNick.toLowerCase()); // Stored as lowercase
      expect(retrieved?.threadId).toBe(threadId);
      expect(retrieved?.channelId).toBe(channelId);
    });

    it('should update PM thread nickname', async () => {
      const oldNick = 'OldNick';
      const newNick = 'NewNick';
      const threadId = '111222333';
      const channelId = '444555666';

      await persistence.savePMThread(oldNick, threadId, channelId);
      await persistence.updatePMThreadNick(oldNick, newNick);

      const oldThread = await persistence.getPMThread(oldNick);
      expect(oldThread).toBeNull();

      const newThread = await persistence.getPMThread(newNick);
      expect(newThread).toBeDefined();
      expect(newThread?.threadId).toBe(threadId);
    });

    it('should load all PM threads', async () => {
        await persistence.savePMThread('User1', 't1', 'c1');
        await persistence.savePMThread('User2', 't2', 'c2');

        const allThreads = await persistence.getAllPMThreads();
        expect(allThreads.size).toBe(2);
        expect(allThreads.get('user1')).toBe('t1');
        expect(allThreads.get('user2')).toBe('t2');
    });
  });

  describe('S3 Uploader Feature Availability', () => {
    it('should expose expected public methods', () => {
        // This verifies the S3Uploader API exists as expected for the features
        const config = {
            region: 'us-east-1',
            bucket: 'test',
            accessKeyId: 'test',
            secretAccessKey: 'test'
        };
        const uploader = new S3Uploader(config);
        
        expect(uploader.uploadFile).toBeDefined();
        expect(uploader.generateSignedUrl).toBeDefined();
        expect(uploader.listObjects).toBeDefined();
        expect(uploader.deleteObject).toBeDefined();
    });
  });
});
