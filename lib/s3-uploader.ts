import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';
import crypto from 'crypto';
import path from 'path';

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;          // For S3-compatible services like MinIO, DigitalOcean Spaces
  forcePathStyle?: boolean;   // Required for some S3-compatible services
  publicUrlBase?: string;     // Custom public URL base (e.g., CDN domain)
  keyPrefix?: string;         // Optional prefix for all uploaded keys
  signedUrlExpiry?: number;   // Signed URL expiry in seconds (default: 3600)
}

export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
}

export interface ListResult {
  objects: S3Object[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface ObjectMetadata {
  contentType: string;
  contentLength: number;
  lastModified: Date;
  etag: string;
  metadata: Record<string, string>;
}

export class S3Uploader {
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = {
      signedUrlExpiry: 3600, // 1 hour default
      ...config
    };

    // Initialize S3 client
    this.client = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle || false,
    });

    logger.info('S3 uploader initialized', { 
      region: this.config.region, 
      bucket: this.config.bucket,
      endpoint: this.config.endpoint 
    });
  }

  /**
   * Upload a file buffer to S3 with a custom filename
   */
  async uploadFile(
    buffer: Buffer, 
    originalFilename: string, 
    customFilename?: string,
    contentType?: string
  ): Promise<UploadResult> {
    try {
      // Generate filename
      const filename = customFilename || this.generateFilename(originalFilename);
      const key = this.config.keyPrefix ? `${this.config.keyPrefix}/${filename}` : filename;

      // Detect content type if not provided
      if (!contentType) {
        contentType = this.getContentType(filename);
      }

      const uploadParams: PutObjectCommandInput = {
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        // Make the object publicly readable
        ACL: 'public-read'
      };

      const command = new PutObjectCommand(uploadParams);
      const _result = await this.client.send(command);

      // Generate public URL
      const url = this.generatePublicUrl(key);

      logger.info('File uploaded successfully', { 
        key, 
        originalFilename, 
        customFilename, 
        size: buffer.length,
        contentType 
      });

      return {
        success: true,
        url,
        key
      };

    } catch (error) {
      logger.error('S3 upload failed', { 
        originalFilename, 
        customFilename, 
        error: (error as Error).message 
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Generate a signed URL for private access (if needed)
   */
  async generateSignedUrl(key: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    return await getSignedUrl(this.client, command, { 
      expiresIn: this.config.signedUrlExpiry 
    });
  }

  /**
   * Generate a unique filename while preserving extension
   */
  private generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    
    // Sanitize basename for URL safety
    const sanitized = basename
      .replace(/[^a-zA-Z0-9\-_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    return `${sanitized}_${timestamp}_${random}${ext}`;
  }

  /**
   * Generate public URL for uploaded file
   */
  private generatePublicUrl(key: string): string {
    if (this.config.publicUrlBase) {
      const baseUrl = this.config.publicUrlBase.replace(/\/$/, '');
      return `${baseUrl}/${key}`;
    }

    if (this.config.endpoint) {
      // S3-compatible service
      const baseUrl = this.config.endpoint.replace(/\/$/, '');
      return `${baseUrl}/${this.config.bucket}/${key}`;
    }

    // Standard AWS S3
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  /**
   * Detect content type based on file extension
   */
  private getContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
      '.tiff': 'image/tiff',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Validate S3 configuration
   */
  static validateConfig(config: Partial<S3Config>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.region) errors.push('S3 region is required');
    if (!config.bucket) errors.push('S3 bucket name is required');
    if (!config.accessKeyId) errors.push('S3 access key ID is required');
    if (!config.secretAccessKey) errors.push('S3 secret access key is required');

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Test S3 connection and permissions
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try to upload a small test file
      const testBuffer = Buffer.from('test', 'utf8');
      const testKey = this.config.keyPrefix 
        ? `${this.config.keyPrefix}/test_${Date.now()}.txt`
        : `test_${Date.now()}.txt`;

      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: testKey,
        Body: testBuffer,
        ContentType: 'text/plain',
        ACL: 'public-read'
      });

      await this.client.send(command);
      logger.info('S3 connection test successful', { testKey });

      return { success: true };

    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('S3 connection test failed', { error: errorMessage });

      return { 
        success: false, 
        error: errorMessage 
      };
    }
  }

  /**
   * Check if a file type is supported for upload
   */
  isSupportedFileType(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();

    // Supported file types - primarily images but also some common file types
    const supportedTypes = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff',
      '.pdf', '.txt', '.json', '.xml', '.zip', '.mp4', '.mp3', '.wav'
    ];

    return supportedTypes.includes(ext);
  }

  /**
   * List objects in the S3 bucket with optional prefix filtering and pagination
   */
  async listObjects(prefix?: string, continuationToken?: string): Promise<ListResult> {
    try {
      const fullPrefix = this.config.keyPrefix
        ? (prefix ? `${this.config.keyPrefix}/${prefix}` : this.config.keyPrefix)
        : prefix;

      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: fullPrefix,
        MaxKeys: 20,
        ContinuationToken: continuationToken
      });

      const response = await this.client.send(command);

      const objects: S3Object[] = (response.Contents || []).map(obj => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
        etag: obj.ETag || ''
      }));

      logger.debug(`Listed ${objects.length} objects with prefix: ${fullPrefix || '(none)'}`);

      return {
        objects,
        isTruncated: response.IsTruncated || false,
        nextContinuationToken: response.NextContinuationToken
      };

    } catch (error) {
      logger.error('Failed to list S3 objects', { prefix, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get metadata for a specific object
   */
  async getObjectMetadata(key: string): Promise<ObjectMetadata> {
    try {
      const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;

      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey
      });

      const response = await this.client.send(command);

      logger.debug(`Retrieved metadata for: ${fullKey}`);

      return {
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength || 0,
        lastModified: response.LastModified || new Date(),
        etag: response.ETag || '',
        metadata: response.Metadata || {}
      };

    } catch (error) {
      logger.error('Failed to get object metadata', { key, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Rename an object by copying to new key and deleting old key
   */
  async renameObject(oldKey: string, newKey: string): Promise<void> {
    try {
      const fullOldKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${oldKey}` : oldKey;
      const fullNewKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${newKey}` : newKey;

      // Copy object to new key
      const copyCommand = new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${fullOldKey}`,
        Key: fullNewKey
      });

      await this.client.send(copyCommand);

      // Delete old key
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullOldKey
      });

      await this.client.send(deleteCommand);

      logger.info(`Renamed object: ${fullOldKey} -> ${fullNewKey}`);

    } catch (error) {
      logger.error('Failed to rename object', { oldKey, newKey, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Delete an object from S3
   */
  async deleteObject(key: string): Promise<void> {
    try {
      const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey
      });

      await this.client.send(command);

      logger.info(`Deleted object: ${fullKey}`);

    } catch (error) {
      logger.error('Failed to delete object', { key, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get a public or signed URL for an object
   */
  async getObjectUrl(key: string, expiresIn?: number): Promise<string> {
    const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;

    if (expiresIn) {
      // Generate signed URL with expiration
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } else {
      // Return public URL
      return this.generatePublicUrl(fullKey);
    }
  }
}