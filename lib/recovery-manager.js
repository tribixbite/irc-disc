"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecoveryManager = void 0;
const logger_1 = require("./logger");
const events_1 = require("events");
class RecoveryManager extends events_1.EventEmitter {
    config;
    discordHealth;
    ircHealth;
    healthCheckTimer;
    recoveryHistory = [];
    circuitBreakers = new Map(); // service -> trip time
    // Recovery state
    isRecovering = false;
    recoveryPromise;
    constructor(config = {}) {
        super();
        this.config = {
            maxRetries: 5,
            baseDelay: 1000, // 1 second
            maxDelay: 60000, // 1 minute
            jitterRange: 0.2, // ±20%
            healthCheckInterval: 30000, // 30 seconds
            circuitBreakerThreshold: 3,
            circuitBreakerTimeout: 300000, // 5 minutes
            ...config
        };
        this.discordHealth = this.initializeHealth();
        this.ircHealth = this.initializeHealth();
        this.startHealthChecking();
        logger_1.logger.info('Recovery manager initialized with config:', this.config);
    }
    initializeHealth() {
        return {
            isHealthy: true,
            lastSuccessful: Date.now(),
            consecutiveFailures: 0,
            totalFailures: 0
        };
    }
    /**
     * Record a successful operation for a service
     */
    recordSuccess(service) {
        const health = service === 'discord' ? this.discordHealth : this.ircHealth;
        health.isHealthy = true;
        health.lastSuccessful = Date.now();
        health.consecutiveFailures = 0;
        // Clear circuit breaker
        this.circuitBreakers.delete(service);
        logger_1.logger.debug(`${service} connection marked as healthy`);
        this.emit('serviceHealthy', service, health);
    }
    /**
     * Record a failure for a service
     */
    recordFailure(service, error) {
        const health = service === 'discord' ? this.discordHealth : this.ircHealth;
        health.consecutiveFailures++;
        health.totalFailures++;
        health.lastError = error;
        // Check if we should trip the circuit breaker
        if (health.consecutiveFailures >= this.config.circuitBreakerThreshold) {
            health.isHealthy = false;
            this.circuitBreakers.set(service, Date.now());
            logger_1.logger.warn(`Circuit breaker tripped for ${service} after ${health.consecutiveFailures} failures`);
            this.emit('circuitBreakerTripped', service, health);
        }
        logger_1.logger.error(`${service} connection failure recorded:`, error?.message || error || 'Unknown error');
        this.emit('serviceUnhealthy', service, health, error);
        // Trigger recovery if not already recovering (fire-and-forget)
        void this.triggerRecovery(service, error);
    }
    /**
     * Check if a service is available (not in circuit breaker state)
     */
    isServiceAvailable(service) {
        const tripTime = this.circuitBreakers.get(service);
        if (!tripTime)
            return true;
        // Check if circuit breaker timeout has elapsed
        if (Date.now() - tripTime > this.config.circuitBreakerTimeout) {
            this.circuitBreakers.delete(service);
            logger_1.logger.info(`Circuit breaker reset for ${service}`);
            this.emit('circuitBreakerReset', service);
            return true;
        }
        return false;
    }
    /**
     * Trigger recovery process for a failed service
     */
    async triggerRecovery(service, error) {
        if (this.isRecovering) {
            logger_1.logger.debug(`Recovery already in progress, skipping trigger for ${service}`);
            return;
        }
        if (!this.isServiceAvailable(service)) {
            logger_1.logger.debug(`${service} circuit breaker is open, skipping recovery`);
            return;
        }
        this.isRecovering = true;
        this.recoveryPromise = this.executeRecovery(service, error);
        try {
            await this.recoveryPromise;
        }
        finally {
            this.isRecovering = false;
            this.recoveryPromise = undefined;
        }
    }
    /**
     * Execute the recovery process with exponential backoff
     */
    async executeRecovery(service, initialError) {
        logger_1.logger.info(`Starting recovery process for ${service}`);
        this.emit('recoveryStarted', service, initialError, this.config.maxRetries);
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            const delay = this.calculateDelay(attempt);
            const recoveryAttempt = {
                attempt,
                timestamp: Date.now(),
                delay,
                reason: `${service} connection failure: ${initialError.message}`,
                success: false
            };
            logger_1.logger.info(`Recovery attempt ${attempt}/${this.config.maxRetries} for ${service} in ${delay}ms`);
            // Wait with exponential backoff
            await this.sleep(delay);
            try {
                // Emit recovery attempt event for the bot to handle
                const success = await this.attemptRecovery(service);
                recoveryAttempt.success = success;
                this.recoveryHistory.push(recoveryAttempt);
                if (success) {
                    logger_1.logger.info(`Recovery successful for ${service} on attempt ${attempt}`);
                    this.recordSuccess(service);
                    this.emit('recoverySucceeded', service, attempt);
                    return;
                }
                else {
                    logger_1.logger.warn(`Recovery attempt ${attempt} failed for ${service}`);
                }
            }
            catch (error) {
                recoveryAttempt.error = error;
                this.recoveryHistory.push(recoveryAttempt);
                logger_1.logger.error(`Recovery attempt ${attempt} failed for ${service}:`, error);
                if (attempt === this.config.maxRetries) {
                    logger_1.logger.error(`All recovery attempts exhausted for ${service}`);
                    this.emit('recoveryFailed', service, error);
                    throw new Error(`Recovery failed for ${service} after ${this.config.maxRetries} attempts`);
                }
            }
        }
    }
    /**
     * Attempt to recover a specific service
     */
    async attemptRecovery(service) {
        return new Promise((resolve) => {
            // Emit event for bot to handle the actual reconnection
            this.emit('attemptReconnection', service, (success) => {
                resolve(success);
            });
            // Timeout after 30 seconds if no response
            setTimeout(() => {
                logger_1.logger.warn(`Recovery attempt for ${service} timed out`);
                resolve(false);
            }, 30000);
        });
    }
    /**
     * Calculate delay with exponential backoff and jitter
     */
    calculateDelay(attempt) {
        const exponentialDelay = Math.min(this.config.baseDelay * Math.pow(2, attempt - 1), this.config.maxDelay);
        // Add jitter to prevent thundering herd
        const jitter = exponentialDelay * this.config.jitterRange * (Math.random() * 2 - 1);
        const finalDelay = Math.max(0, exponentialDelay + jitter);
        return Math.floor(finalDelay);
    }
    /**
     * Sleep for specified milliseconds
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Start periodic health checking
     */
    startHealthChecking() {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckInterval);
        logger_1.logger.debug(`Health checking started with ${this.config.healthCheckInterval}ms interval`);
    }
    /**
     * Perform health check on both services
     */
    performHealthCheck() {
        const now = Date.now();
        // Check if services have been silent for too long
        const maxSilence = this.config.healthCheckInterval * 3; // 3x the check interval
        for (const [service, health] of [['discord', this.discordHealth], ['irc', this.ircHealth]]) {
            if (health.isHealthy && now - health.lastSuccessful > maxSilence) {
                logger_1.logger.warn(`${service} has been silent for ${now - health.lastSuccessful}ms, marking as potentially unhealthy`);
                this.emit('serviceSilent', service, health);
            }
        }
        this.emit('healthCheck', {
            discord: this.discordHealth,
            irc: this.ircHealth,
            timestamp: now
        });
    }
    /**
     * Get current health status
     */
    getHealthStatus() {
        return {
            discord: { ...this.discordHealth },
            irc: { ...this.ircHealth },
            isRecovering: this.isRecovering,
            circuitBreakers: Object.fromEntries(this.circuitBreakers),
            recoveryHistory: [...this.recoveryHistory.slice(-10)] // Last 10 attempts
        };
    }
    /**
     * Force a manual recovery attempt
     */
    async forceRecovery(service) {
        if (this.isRecovering) {
            throw new Error('Recovery already in progress');
        }
        logger_1.logger.info(`Manual recovery triggered for ${service}`);
        await this.triggerRecovery(service, new Error('Manual recovery requested'));
    }
    /**
     * Reset circuit breaker for a service
     */
    resetCircuitBreaker(service) {
        this.circuitBreakers.delete(service);
        const health = service === 'discord' ? this.discordHealth : this.ircHealth;
        health.consecutiveFailures = 0;
        logger_1.logger.info(`Circuit breaker manually reset for ${service}`);
        this.emit('circuitBreakerReset', service);
    }
    /**
     * Update recovery configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger_1.logger.info('Recovery manager configuration updated:', newConfig);
    }
    /**
     * Get recovery statistics
     */
    getStatistics() {
        const successful = this.recoveryHistory.filter(a => a.success).length;
        const failed = this.recoveryHistory.filter(a => !a.success).length;
        const recoveryTimes = this.recoveryHistory
            .filter(a => a.success)
            .map(a => a.delay);
        const averageRecoveryTime = recoveryTimes.length > 0
            ? recoveryTimes.reduce((sum, time) => sum + time, 0) / recoveryTimes.length
            : 0;
        return {
            totalRecoveryAttempts: this.recoveryHistory.length,
            successfulRecoveries: successful,
            failedRecoveries: failed,
            averageRecoveryTime,
            discordHealth: { ...this.discordHealth },
            ircHealth: { ...this.ircHealth }
        };
    }
    /**
     * Clear recovery history
     */
    clearHistory() {
        this.recoveryHistory = [];
        logger_1.logger.info('Recovery history cleared');
    }
    /**
     * Cleanup when shutting down
     */
    destroy() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
        this.removeAllListeners();
        logger_1.logger.info('Recovery manager destroyed');
    }
}
exports.RecoveryManager = RecoveryManager;
