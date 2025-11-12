"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var winston_1 = __importStar(require("winston"));
var util_1 = require("util");
function simpleInspect(value) {
    if (typeof value === 'string')
        return value;
    return (0, util_1.inspect)(value, { depth: null });
}
function formatter(info) {
    var splat = info[Symbol.for('splat')] || [];
    var stringifiedRest = splat.length > 0 ? " ".concat(splat.map(simpleInspect).join(' ')) : '';
    var padding = (info.padding && info.padding[info.level]) || '';
    return "".concat(info.timestamp, " ").concat(info.level, ":").concat(padding, " ").concat(info.message).concat(stringifiedRest);
}
exports.logger = winston_1.default.createLogger({
    transports: [new winston_1.default.transports.Console()],
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    format: winston_1.format.combine(winston_1.format.colorize(), winston_1.format.timestamp(), winston_1.format.printf(formatter)),
});
