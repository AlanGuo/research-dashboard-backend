const miscRequests = require('./src/miscRequests');
const Client = require('./src/client');
const BuiltInIndicator = require('./src/classes/BuiltInIndicator');
const PineIndicator = require('./src/classes/PineIndicator');
const PinePermManager = require('./src/classes/PinePermManager');

const TradingView = { ...miscRequests, Client, BuiltInIndicator, PineIndicator, PinePermManager };

module.exports = { TradingView };
