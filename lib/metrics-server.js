"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsServer = void 0;
const http_1 = __importDefault(require("http"));
const logger_1 = require("./logger");
const package_json_1 = __importDefault(require("../package.json"));
class MetricsServer {
    server = null;
    metricsCollector;
    port;
    constructor(metricsCollector, port = 3001) {
        this.metricsCollector = metricsCollector;
        this.port = port;
    }
    start() {
        this.server = http_1.default.createServer((req, res) => {
            // CORS headers for web dashboards
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            const url = req.url || '';
            try {
                switch (url) {
                    case '/health':
                        this.handleHealth(res);
                        break;
                    case '/metrics':
                        this.handleMetrics(res);
                        break;
                    case '/metrics/prometheus':
                        this.handlePrometheusMetrics(res);
                        break;
                    case '/metrics/summary':
                        this.handleSummary(res);
                        break;
                    case '/metrics/detailed':
                        this.handleDetailed(res);
                        break;
                    case '/metrics/recent':
                        this.handleRecent(res);
                        break;
                    default:
                        this.handle404(res);
                }
            }
            catch (error) {
                logger_1.logger.error('Error handling metrics request:', error);
                this.handleError(res, error);
            }
        });
        this.server.listen(this.port, () => {
            logger_1.logger.info(`Metrics server listening on port ${this.port}`);
            logger_1.logger.info('Available endpoints:');
            logger_1.logger.info(`  - http://localhost:${this.port}/health - Health check`);
            logger_1.logger.info(`  - http://localhost:${this.port}/metrics - Basic metrics`);
            logger_1.logger.info(`  - http://localhost:${this.port}/metrics/prometheus - Prometheus format`);
            logger_1.logger.info(`  - http://localhost:${this.port}/metrics/summary - Summary statistics`);
            logger_1.logger.info(`  - http://localhost:${this.port}/metrics/detailed - Detailed breakdown`);
            logger_1.logger.info(`  - http://localhost:${this.port}/metrics/recent - Recent activity`);
        });
        this.server.on('error', (error) => {
            logger_1.logger.error('Metrics server error:', error);
        });
    }
    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
            logger_1.logger.info('Metrics server stopped');
        }
    }
    handleHealth(res) {
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: package_json_1.default.version
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
    }
    handleMetrics(res) {
        const summary = this.metricsCollector.getSummary();
        const recent = this.metricsCollector.getRecentActivity();
        const metrics = {
            timestamp: new Date().toISOString(),
            summary,
            recent,
            endpoints: {
                detailed: '/metrics/detailed',
                prometheus: '/metrics/prometheus',
                recent: '/metrics/recent'
            }
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metrics, null, 2));
    }
    handlePrometheusMetrics(res) {
        const prometheusMetrics = this.metricsCollector.exportPrometheusMetrics();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(prometheusMetrics);
    }
    handleSummary(res) {
        const summary = this.metricsCollector.getSummary();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            timestamp: new Date().toISOString(),
            ...summary
        }, null, 2));
    }
    handleDetailed(res) {
        const detailed = this.metricsCollector.getDetailedMetrics();
        // Convert Sets and Maps to arrays for JSON serialization
        const serializable = {
            ...detailed,
            uniqueDiscordUsers: Array.from(detailed.uniqueDiscordUsers),
            uniqueIRCUsers: Array.from(detailed.uniqueIRCUsers),
            channelActivity: Object.fromEntries(detailed.channelActivity),
            userActivity: Object.fromEntries(detailed.userActivity),
            timestamp: new Date().toISOString()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serializable, null, 2));
    }
    handleRecent(res) {
        const recent = this.metricsCollector.getRecentActivity();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            timestamp: new Date().toISOString(),
            ...recent
        }, null, 2));
    }
    handle404(res) {
        const notFound = {
            error: 'Not Found',
            message: 'Endpoint not found',
            availableEndpoints: [
                '/health',
                '/metrics',
                '/metrics/prometheus',
                '/metrics/summary',
                '/metrics/detailed',
                '/metrics/recent'
            ]
        };
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notFound, null, 2));
    }
    handleError(res, _error) {
        const errorResponse = {
            error: 'Internal Server Error',
            message: 'An error occurred while processing the request',
            timestamp: new Date().toISOString()
        };
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorResponse, null, 2));
    }
}
exports.MetricsServer = MetricsServer;
