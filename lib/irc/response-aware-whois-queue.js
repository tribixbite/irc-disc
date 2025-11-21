"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseAwareWhoisQueue = void 0;
const logger_1 = require("../logger");
/**
 * Response-aware WHOIS queue that prevents IRC server flood kicks
 *
 * Instead of sending WHOIS requests as fast as possible, this queue:
 * 1. Sends one WHOIS request at a time
 * 2. Waits for the RPL_ENDOFWHOIS (318) response before sending the next
 * 3. Includes a timeout fallback to prevent queue stalling
 *
 * This prevents "Excess Flood" kicks when joining channels with many users.
 */
class ResponseAwareWhoisQueue {
    queue = [];
    isProcessing = false;
    ircClient;
    timeoutMs;
    constructor(ircClient, timeoutMs = 5000) {
        this.ircClient = ircClient;
        this.timeoutMs = timeoutMs;
    }
    /**
     * Add a nickname to the WHOIS queue
     * Prevents duplicate requests for the same nick
     */
    add(nick) {
        if (!nick || typeof nick !== 'string') {
            logger_1.logger.warn('Invalid nick provided to WHOIS queue:', nick);
            return;
        }
        // Avoid duplicates in queue
        if (!this.queue.includes(nick)) {
            this.queue.push(nick);
            logger_1.logger.debug(`Added ${nick} to WHOIS queue (length: ${this.queue.length})`);
            // Start processing if not already running
            if (!this.isProcessing) {
                void this.process();
            }
        }
    }
    /**
     * Get current queue length
     */
    getQueueLength() {
        return this.queue.length;
    }
    /**
     * Check if queue is currently processing
     */
    isActive() {
        return this.isProcessing;
    }
    /**
     * Process the queue one item at a time
     */
    async process() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }
        this.isProcessing = true;
        const nick = this.queue.shift();
        if (!nick) {
            this.isProcessing = false;
            return;
        }
        try {
            // Wait for the WHOIS response with timeout
            await this.waitForWhoisResponse(nick);
            logger_1.logger.debug(`Successfully received WHOIS for ${nick}`);
        }
        catch (error) {
            // Timeout or error - skip and continue
            logger_1.logger.warn(`WHOIS for ${nick} failed or timed out:`, error);
            // Don't re-queue failed requests - just move on
        }
        finally {
            this.isProcessing = false;
            // Process next item immediately if queue is not empty
            if (this.queue.length > 0) {
                void this.process();
            }
        }
    }
    /**
     * Wait for RPL_ENDOFWHOIS (318) response for a specific nick
     */
    async waitForWhoisResponse(nick) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                // Timeout - cleanup listener and reject
                this.ircClient.removeListener('rpl_endofwhois', listener);
                reject(new Error(`Timeout: Did not receive WHOIS response for ${nick} within ${this.timeoutMs}ms`));
            }, this.timeoutMs);
            const listener = (message) => {
                // RPL_ENDOFWHOIS format: :server 318 <our_nick> <target_nick> :End of /WHOIS list.
                // args[1] is the target nick
                const responseNick = message.args[1];
                if (responseNick === nick) {
                    clearTimeout(timer);
                    this.ircClient.removeListener('rpl_endofwhois', listener);
                    resolve();
                }
            };
            // Attach listener before sending request
            this.ircClient.on('rpl_endofwhois', listener);
            // Send the WHOIS request
            try {
                // Send WHOIS request
                this.ircClient.whois(nick);
            }
            catch (error) {
                // Failed to send WHOIS - cleanup and reject
                clearTimeout(timer);
                this.ircClient.removeListener('rpl_endofwhois', listener);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
    /**
     * Clear the queue (useful for shutdown/cleanup)
     */
    clear() {
        const cleared = this.queue.length;
        this.queue = [];
        if (cleared > 0) {
            logger_1.logger.info(`Cleared ${cleared} pending WHOIS requests from queue`);
        }
    }
    /**
     * Get queue statistics for monitoring
     */
    getStats() {
        return {
            queueLength: this.queue.length,
            isProcessing: this.isProcessing
        };
    }
}
exports.ResponseAwareWhoisQueue = ResponseAwareWhoisQueue;
