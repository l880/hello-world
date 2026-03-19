const { handleCalendarRequest } = require('../lib/calendar-data');

module.exports = async (_req, res) => {
  const response = await handleCalendarRequest();
  Object.entries(response.headers).forEach(([key, value]) => res.setHeader(key, value));
  res.statusCode = response.statusCode;
  res.end(response.body);
};
