"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistenceService = void 0;
var sqlite3_1 = __importDefault(require("sqlite3"));
var logger_1 = require("./logger");
var PersistenceService = /** @class */ (function () {
    function PersistenceService(dbPath) {
        if (dbPath === void 0) { dbPath = './discord-irc.db'; }
        this.dbPath = dbPath;
    }
    PersistenceService.prototype.initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        _this.db = new sqlite3_1.default.Database(_this.dbPath, function (err) {
                            if (err) {
                                logger_1.logger.error('Failed to open database:', err);
                                reject(err);
                                return;
                            }
                            logger_1.logger.info("Connected to SQLite database at ".concat(_this.dbPath));
                            // Enable WAL mode for better concurrency and crash recovery
                            // NOTE: WAL mode requires backup tools to copy both .db and .db-wal files
                            // See README for backup considerations
                            _this.db.run('PRAGMA journal_mode = WAL;', function (walErr) {
                                if (walErr) {
                                    logger_1.logger.warn('Failed to enable WAL mode, using default journal mode:', walErr);
                                }
                                else {
                                    logger_1.logger.info('SQLite WAL mode enabled for improved concurrency');
                                }
                                // Proceed with table creation regardless of WAL mode result
                                _this.createTables().then(resolve).catch(reject);
                            });
                        });
                    })];
            });
        });
    };
    /**
     * Execute a write operation with automatic retry on SQLITE_BUSY errors
     * Uses exponential backoff with jitter to reduce contention
     *
     * @param operation Function that performs the database write operation
     * @param maxRetries Maximum number of retry attempts (default: 5)
     * @param baseDelay Initial delay in milliseconds (default: 50ms)
     * @returns Promise that resolves when the operation succeeds
     */
    PersistenceService.prototype.writeWithRetry = function (operation_1) {
        return __awaiter(this, arguments, void 0, function (operation, maxRetries, baseDelay) {
            var _loop_1, attempt, state_1;
            if (maxRetries === void 0) { maxRetries = 5; }
            if (baseDelay === void 0) { baseDelay = 50; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _loop_1 = function (attempt) {
                            var _b, error_1, isBusyError, exponentialDelay, jitter, delay_1;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        _c.trys.push([0, 2, , 4]);
                                        _b = {};
                                        return [4 /*yield*/, operation()];
                                    case 1: return [2 /*return*/, (_b.value = _c.sent(), _b)];
                                    case 2:
                                        error_1 = _c.sent();
                                        isBusyError = (error_1 === null || error_1 === void 0 ? void 0 : error_1.code) === 'SQLITE_BUSY' || (error_1 === null || error_1 === void 0 ? void 0 : error_1.errno) === 5;
                                        if (!isBusyError || attempt === maxRetries) {
                                            // Not a busy error or out of retries - throw the error
                                            throw error_1;
                                        }
                                        exponentialDelay = baseDelay * Math.pow(2, attempt);
                                        jitter = Math.random() * 0.3 * exponentialDelay;
                                        delay_1 = exponentialDelay + jitter;
                                        logger_1.logger.debug("SQLITE_BUSY error on attempt ".concat(attempt + 1, "/").concat(maxRetries + 1, ", ") +
                                            "retrying after ".concat(Math.round(delay_1), "ms"));
                                        // Wait before retrying
                                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, delay_1); })];
                                    case 3:
                                        // Wait before retrying
                                        _c.sent();
                                        return [3 /*break*/, 4];
                                    case 4: return [2 /*return*/];
                                }
                            });
                        };
                        attempt = 0;
                        _a.label = 1;
                    case 1:
                        if (!(attempt <= maxRetries)) return [3 /*break*/, 4];
                        return [5 /*yield**/, _loop_1(attempt)];
                    case 2:
                        state_1 = _a.sent();
                        if (typeof state_1 === "object")
                            return [2 /*return*/, state_1.value];
                        _a.label = 3;
                    case 3:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 4: 
                    // This should never be reached due to the throw in the loop
                    throw new Error('writeWithRetry: Unexpected code path');
                }
            });
        });
    };
    PersistenceService.prototype.createTables = function () {
        return __awaiter(this, void 0, void 0, function () {
            var queries, _loop_2, _i, queries_1, query;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        queries = [
                            "CREATE TABLE IF NOT EXISTS pm_threads (\n        irc_nick TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        channel_id TEXT NOT NULL,\n        last_activity INTEGER NOT NULL,\n        created_at INTEGER DEFAULT (strftime('%s', 'now'))\n      )",
                            "CREATE TABLE IF NOT EXISTS channel_users (\n        channel TEXT PRIMARY KEY,\n        users TEXT NOT NULL,\n        last_updated INTEGER NOT NULL\n      )",
                            "CREATE TABLE IF NOT EXISTS bot_metrics (\n        key TEXT PRIMARY KEY,\n        value TEXT NOT NULL,\n        updated_at INTEGER DEFAULT (strftime('%s', 'now'))\n      )"
                        ];
                        _loop_2 = function (query) {
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0: return [4 /*yield*/, new Promise(function (resolve, reject) {
                                            _this.db.run(query, function (err) {
                                                if (err)
                                                    reject(err);
                                                else
                                                    resolve();
                                            });
                                        })];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        _i = 0, queries_1 = queries;
                        _a.label = 1;
                    case 1:
                        if (!(_i < queries_1.length)) return [3 /*break*/, 4];
                        query = queries_1[_i];
                        return [5 /*yield**/, _loop_2(query)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4:
                        logger_1.logger.debug('Database tables created/verified');
                        return [2 /*return*/];
                }
            });
        });
    };
    PersistenceService.prototype.savePMThread = function (ircNick, threadId, channelId) {
        return __awaiter(this, void 0, void 0, function () {
            var now;
            var _this = this;
            return __generator(this, function (_a) {
                now = Date.now();
                return [2 /*return*/, this.writeWithRetry(function () { return new Promise(function (resolve, reject) {
                        _this.db.run("\n        INSERT OR REPLACE INTO pm_threads\n        (irc_nick, thread_id, channel_id, last_activity)\n        VALUES (?, ?, ?, ?)\n      ", [ircNick.toLowerCase(), threadId, channelId, now], function (err) {
                            if (err) {
                                logger_1.logger.error('Failed to save PM thread:', err);
                                reject(err);
                            }
                            else {
                                logger_1.logger.debug("Saved PM thread mapping: ".concat(ircNick, " -> ").concat(threadId));
                                resolve();
                            }
                        });
                    }); })];
            });
        });
    };
    PersistenceService.prototype.getPMThread = function (ircNick) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        _this.db.get("\n        SELECT irc_nick, thread_id, channel_id, last_activity \n        FROM pm_threads \n        WHERE irc_nick = ?\n      ", [ircNick.toLowerCase()], function (err, row) {
                            if (err) {
                                logger_1.logger.error('Failed to get PM thread:', err);
                                resolve(null);
                            }
                            else if (!row) {
                                resolve(null);
                            }
                            else {
                                resolve({
                                    ircNick: row.irc_nick,
                                    threadId: row.thread_id,
                                    channelId: row.channel_id,
                                    lastActivity: row.last_activity
                                });
                            }
                        });
                    })];
            });
        });
    };
    PersistenceService.prototype.getAllPMThreads = function () {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            var _this = this;
            return __generator(this, function (_a) {
                result = new Map();
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.db.all("\n        SELECT irc_nick, thread_id \n        FROM pm_threads\n      ", function (err, rows) {
                            if (err) {
                                logger_1.logger.error('Failed to load PM threads:', err);
                                resolve(result);
                            }
                            else {
                                for (var _i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
                                    var row = rows_1[_i];
                                    result.set(row.irc_nick, row.thread_id);
                                }
                                logger_1.logger.debug("Loaded ".concat(result.size, " PM thread mappings from database"));
                                resolve(result);
                            }
                        });
                    })];
            });
        });
    };
    PersistenceService.prototype.updatePMThreadNick = function (oldNick, newNick) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, this.writeWithRetry(function () { return new Promise(function (resolve, reject) {
                        _this.db.run("\n        UPDATE pm_threads\n        SET irc_nick = ?, last_activity = ?\n        WHERE irc_nick = ?\n      ", [newNick.toLowerCase(), Date.now(), oldNick.toLowerCase()], function (err) {
                            if (err) {
                                logger_1.logger.error('Failed to update PM thread nick:', err);
                                reject(err);
                            }
                            else {
                                logger_1.logger.debug("Updated PM thread nick: ".concat(oldNick, " -> ").concat(newNick));
                                resolve();
                            }
                        });
                    }); })];
            });
        });
    };
    PersistenceService.prototype.deletePMThread = function (ircNick) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, this.writeWithRetry(function () { return new Promise(function (resolve, reject) {
                        _this.db.run("\n        DELETE FROM pm_threads\n        WHERE irc_nick = ?\n      ", [ircNick.toLowerCase()], function (err) {
                            if (err) {
                                logger_1.logger.error('Failed to delete PM thread:', err);
                                reject(err);
                            }
                            else {
                                logger_1.logger.debug("Deleted PM thread for: ".concat(ircNick));
                                resolve();
                            }
                        });
                    }); })];
            });
        });
    };
    PersistenceService.prototype.saveChannelUsers = function (channel, users) {
        return __awaiter(this, void 0, void 0, function () {
            var usersArray, usersJson, now;
            var _this = this;
            return __generator(this, function (_a) {
                usersArray = Array.from(users);
                usersJson = JSON.stringify(usersArray);
                now = Date.now();
                return [2 /*return*/, this.writeWithRetry(function () { return new Promise(function (resolve, reject) {
                        _this.db.run("\n        INSERT OR REPLACE INTO channel_users\n        (channel, users, last_updated)\n        VALUES (?, ?, ?)\n      ", [channel, usersJson, now], function (err) {
                            if (err) {
                                logger_1.logger.error('Failed to save channel users:', err);
                                reject(err);
                            }
                            else {
                                logger_1.logger.debug("Saved ".concat(usersArray.length, " users for channel ").concat(channel));
                                resolve();
                            }
                        });
                    }); })];
            });
        });
    };
    PersistenceService.prototype.getChannelUsers = function (channel) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.db.get("\n        SELECT users \n        FROM channel_users \n        WHERE channel = ?\n      ", [channel], function (err, row) {
                            if (err) {
                                logger_1.logger.error('Failed to get channel users:', err);
                                resolve(new Set());
                            }
                            else if (!row) {
                                resolve(new Set());
                            }
                            else {
                                try {
                                    var users = JSON.parse(row.users);
                                    resolve(new Set(users));
                                }
                                catch (parseErr) {
                                    logger_1.logger.error('Failed to parse channel users JSON:', parseErr);
                                    resolve(new Set());
                                }
                            }
                        });
                    })];
            });
        });
    };
    PersistenceService.prototype.getAllChannelUsers = function () {
        return __awaiter(this, void 0, void 0, function () {
            var result;
            var _this = this;
            return __generator(this, function (_a) {
                result = {};
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.db.all("\n        SELECT channel, users \n        FROM channel_users\n      ", function (err, rows) {
                            if (err) {
                                logger_1.logger.error('Failed to load channel users:', err);
                                resolve(result);
                            }
                            else {
                                for (var _i = 0, rows_2 = rows; _i < rows_2.length; _i++) {
                                    var row = rows_2[_i];
                                    try {
                                        var users = JSON.parse(row.users);
                                        result[row.channel] = new Set(users);
                                    }
                                    catch (parseErr) {
                                        logger_1.logger.error("Failed to parse channel users for ".concat(row.channel, ":"), parseErr);
                                    }
                                }
                                logger_1.logger.debug("Loaded channel users for ".concat(Object.keys(result).length, " channels"));
                                resolve(result);
                            }
                        });
                    })];
            });
        });
    };
    PersistenceService.prototype.saveMetric = function (key, value) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, this.writeWithRetry(function () { return new Promise(function (resolve, reject) {
                        _this.db.run("\n        INSERT OR REPLACE INTO bot_metrics\n        (key, value)\n        VALUES (?, ?)\n      ", [key, value], function (err) {
                            if (err) {
                                logger_1.logger.error('Failed to save metric:', err);
                                reject(err);
                            }
                            else {
                                resolve();
                            }
                        });
                    }); })];
            });
        });
    };
    PersistenceService.prototype.getMetric = function (key) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.db.get("\n        SELECT value \n        FROM bot_metrics \n        WHERE key = ?\n      ", [key], function (err, row) {
                            if (err) {
                                logger_1.logger.error('Failed to get metric:', err);
                                resolve(null);
                            }
                            else {
                                resolve(row ? row.value : null);
                            }
                        });
                    })];
            });
        });
    };
    PersistenceService.prototype.close = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        _this.db.close(function (err) {
                            if (err) {
                                logger_1.logger.error('Error closing database:', err);
                            }
                            else {
                                logger_1.logger.info('Database connection closed');
                            }
                            resolve();
                        });
                    })];
            });
        });
    };
    PersistenceService.prototype.cleanup = function () {
        return __awaiter(this, void 0, void 0, function () {
            var sevenDaysAgo, oneDayAgo, queries, _loop_3, this_1, _i, queries_2, query;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                        oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
                        queries = [
                            // Clean up old PM threads (inactive for more than 7 days)
                            { sql: 'DELETE FROM pm_threads WHERE last_activity < ?', params: [sevenDaysAgo] },
                            // Clean up old channel user data (older than 1 day)
                            { sql: 'DELETE FROM channel_users WHERE last_updated < ?', params: [oneDayAgo] }
                        ];
                        _loop_3 = function (query) {
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0: return [4 /*yield*/, this_1.writeWithRetry(function () { return new Promise(function (resolve, reject) {
                                            _this.db.run(query.sql, query.params, function (err) {
                                                if (err) {
                                                    logger_1.logger.error('Failed to cleanup database:', err);
                                                    reject(err);
                                                }
                                                else {
                                                    resolve();
                                                }
                                            });
                                        }); })];
                                    case 1:
                                        _b.sent();
                                        return [2 /*return*/];
                                }
                            });
                        };
                        this_1 = this;
                        _i = 0, queries_2 = queries;
                        _a.label = 1;
                    case 1:
                        if (!(_i < queries_2.length)) return [3 /*break*/, 4];
                        query = queries_2[_i];
                        return [5 /*yield**/, _loop_3(query)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4:
                        logger_1.logger.debug('Database cleanup completed');
                        return [2 /*return*/];
                }
            });
        });
    };
    return PersistenceService;
}());
exports.PersistenceService = PersistenceService;
