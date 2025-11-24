"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Uploader = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const logger_1 = require("./logger");
const s3_rate_limiter_1 = require("./s3-rate-limiter");
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
class S3Uploader {
    client;
    config;
    rateLimiter;
    constructor(config) {
        this.config = {
            signedUrlExpiry: 3600, // 1 hour default
            ...config
        };
        // Initialize S3 client
        this.client = new client_s3_1.S3Client({
            region: this.config.region,
            credentials: {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey,
            },
            endpoint: this.config.endpoint,
            forcePathStyle: this.config.forcePathStyle || false,
        });
        // Initialize Rate Limiter
        this.rateLimiter = this.config.rateLimitConfig
            ? new s3_rate_limiter_1.S3RateLimiter(this.config.rateLimitConfig)
            : (0, s3_rate_limiter_1.createDefaultS3RateLimiter)();
        logger_1.logger.info('S3 uploader initialized', {
            region: this.config.region,
            bucket: this.config.bucket,
            endpoint: this.config.endpoint
        });
    }
    /**
     * Upload a file buffer to S3 with a custom filename
     */
    async uploadFile(userId, buffer, originalFilename, customFilename, contentType) {
        try {
            // Check rate limit
            const limitCheck = this.rateLimiter.checkLimit(userId);
            if (!limitCheck.allowed) {
                const retrySeconds = limitCheck.retryAfter || 60;
                throw new Error(`Rate limit exceeded. Try again in ${retrySeconds} seconds.`);
            }
            // Generate filename
            const filename = customFilename || this.generateFilename(originalFilename);
            const key = this.config.keyPrefix ? `${this.config.keyPrefix}/${filename}` : filename;
            // Detect content type if not provided
            if (!contentType) {
                contentType = this.getContentType(filename);
            }
            const uploadParams = {
                Bucket: this.config.bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
                // Make the object publicly readable
                ACL: 'public-read'
            };
            const command = new client_s3_1.PutObjectCommand(uploadParams);
            const _result = await this.client.send(command);
            // Generate public URL
            const url = this.generatePublicUrl(key);
            logger_1.logger.info('File uploaded successfully', {
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
        }
        catch (error) {
            logger_1.logger.error('S3 upload failed', {
                originalFilename,
                customFilename,
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    }
    /**
     * Generate a signed URL for private access (if needed)
     */
    async generateSignedUrl(key) {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.config.bucket,
            Key: key,
        });
        return await (0, s3_request_presigner_1.getSignedUrl)(this.client, command, {
            expiresIn: this.config.signedUrlExpiry
        });
    }
    /**
     * Generate a unique filename while preserving extension
     */
    generateFilename(originalFilename) {
        const ext = path_1.default.extname(originalFilename);
        const basename = path_1.default.basename(originalFilename, ext);
        const timestamp = Date.now();
        const random = crypto_1.default.randomBytes(4).toString('hex');
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
    generatePublicUrl(key) {
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
    getContentType(filename) {
        const ext = path_1.default.extname(filename).toLowerCase();
        const mimeTypes = {
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
    static validateConfig(config) {
        const errors = [];
        if (!config.region)
            errors.push('S3 region is required');
        if (!config.bucket)
            errors.push('S3 bucket name is required');
        if (!config.accessKeyId)
            errors.push('S3 access key ID is required');
        if (!config.secretAccessKey)
            errors.push('S3 secret access key is required');
        return {
            valid: errors.length === 0,
            errors
        };
    }
    /**
     * Test S3 connection and permissions
     */
    async testConnection() {
        try {
            // Try to upload a small test file
            const testBuffer = Buffer.from('test', 'utf8');
            const testKey = this.config.keyPrefix
                ? `${this.config.keyPrefix}/test_${Date.now()}.txt`
                : `test_${Date.now()}.txt`;
            const command = new client_s3_1.PutObjectCommand({
                Bucket: this.config.bucket,
                Key: testKey,
                Body: testBuffer,
                ContentType: 'text/plain',
                ACL: 'public-read'
            });
            await this.client.send(command);
            logger_1.logger.info('S3 connection test successful', { testKey });
            return { success: true };
        }
        catch (error) {
            const errorMessage = error.message;
            logger_1.logger.error('S3 connection test failed', { error: errorMessage });
            return {
                success: false,
                error: errorMessage
            };
        }
    }
    /**
     * Check if a file type is supported for upload
     */
    isSupportedFileType(filename) {
        const ext = path_1.default.extname(filename).toLowerCase();
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
    async listObjects(prefix, continuationToken) {
        try {
            const fullPrefix = this.config.keyPrefix
                ? (prefix ? `${this.config.keyPrefix}/${prefix}` : this.config.keyPrefix)
                : prefix;
            const command = new client_s3_1.ListObjectsV2Command({
                Bucket: this.config.bucket,
                Prefix: fullPrefix,
                MaxKeys: 20,
                ContinuationToken: continuationToken
            });
            const response = await this.client.send(command);
            const objects = (response.Contents || []).map(obj => ({
                key: obj.Key,
                size: obj.Size || 0,
                lastModified: obj.LastModified || new Date(),
                etag: obj.ETag || ''
            }));
            logger_1.logger.debug(`Listed ${objects.length} objects with prefix: ${fullPrefix || '(none)'}`);
            return {
                objects,
                isTruncated: response.IsTruncated || false,
                nextContinuationToken: response.NextContinuationToken
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to list S3 objects', { prefix, error: error.message });
            throw error;
        }
    }
    /**
     * Get metadata for a specific object
     */
    async getObjectMetadata(key) {
        try {
            const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;
            const command = new client_s3_1.HeadObjectCommand({
                Bucket: this.config.bucket,
                Key: fullKey
            });
            const response = await this.client.send(command);
            logger_1.logger.debug(`Retrieved metadata for: ${fullKey}`);
            return {
                contentType: response.ContentType || 'application/octet-stream',
                contentLength: response.ContentLength || 0,
                lastModified: response.LastModified || new Date(),
                etag: response.ETag || '',
                metadata: response.Metadata || {}
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get object metadata', { key, error: error.message });
            throw error;
        }
    }
    /**
     * Rename an object by copying to new key and deleting old key
     */
    async renameObject(oldKey, newKey) {
        try {
            const fullOldKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${oldKey}` : oldKey;
            const fullNewKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${newKey}` : newKey;
            // Copy object to new key
            const copyCommand = new client_s3_1.CopyObjectCommand({
                Bucket: this.config.bucket,
                CopySource: `${this.config.bucket}/${fullOldKey}`,
                Key: fullNewKey
            });
            await this.client.send(copyCommand);
            // Delete old key
            const deleteCommand = new client_s3_1.DeleteObjectCommand({
                Bucket: this.config.bucket,
                Key: fullOldKey
            });
            await this.client.send(deleteCommand);
            logger_1.logger.info(`Renamed object: ${fullOldKey} -> ${fullNewKey}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to rename object', { oldKey, newKey, error: error.message });
            throw error;
        }
    }
    /**
     * Delete an object from S3
     */
    async deleteObject(key) {
        try {
            const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;
            const command = new client_s3_1.DeleteObjectCommand({
                Bucket: this.config.bucket,
                Key: fullKey
            });
            await this.client.send(command);
            logger_1.logger.info(`Deleted object: ${fullKey}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to delete object', { key, error: error.message });
            throw error;
        }
    }
    /**
     * Get a public or signed URL for an object
     */
    async getObjectUrl(key, expiresIn) {
        const fullKey = this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;
        if (expiresIn) {
            // Generate signed URL with expiration
            const command = new client_s3_1.GetObjectCommand({
                Bucket: this.config.bucket,
                Key: fullKey
            });
            return await (0, s3_request_presigner_1.getSignedUrl)(this.client, command, { expiresIn });
        }
        else {
            // Return public URL
            return this.generatePublicUrl(fullKey);
        }
    }
}
exports.S3Uploader = S3Uploader;
