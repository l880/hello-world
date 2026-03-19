const { handleDashboardRequest } = require('../../lib/market-data');

exports.handler = async (event) => handleDashboardRequest(event);
