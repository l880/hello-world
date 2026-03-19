const { handleDashboardRequest } = require('../lib/market-data');

module.exports = async (req, res) => {
  const response = await handleDashboardRequest({
    url: `https://${req.headers.host}${req.url}`,
    path: req.url,
  });

  Object.entries(response.headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = response.statusCode;
  res.end(response.body);
};
