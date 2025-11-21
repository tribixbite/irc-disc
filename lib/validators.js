"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateChannelMapping = validateChannelMapping;
function validateChannelMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') {
        throw new Error('Invalid channel mapping given: ' + JSON.stringify(mapping));
    }
    return mapping;
}
