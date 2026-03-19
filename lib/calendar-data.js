const STATIC_EVENTS = [
  { region: 'US', event: 'Initial Jobless Claims', impact: 'medium', category: 'labor' },
  { region: 'US', event: 'Non-Farm Payrolls', impact: 'high', category: 'labor' },
  { region: 'US', event: 'CPI YoY', impact: 'high', category: 'inflation' },
  { region: 'US', event: 'PPI YoY', impact: 'medium', category: 'inflation' },
  { region: 'US', event: 'Core PCE Price Index', impact: 'high', category: 'inflation' },
  { region: 'US', event: 'FOMC Rate Decision', impact: 'high', category: 'central-bank' },
  { region: 'EU', event: 'ECB Rate Decision', impact: 'high', category: 'central-bank' },
  { region: 'CN', event: 'China PMI', impact: 'medium', category: 'growth' },
];

function upcomingDate(offsetDays, hour, minute) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, hour, minute, 0));
  return date.toISOString();
}

function buildFallbackCalendar() {
  return STATIC_EVENTS.map((item, index) => ({
    id: `${item.region}-${item.event}-${index}`,
    ...item,
    scheduledAt: upcomingDate(index, index % 2 === 0 ? 12 : 18, index % 2 === 0 ? 30 : 0),
    source: 'internal-calendar-service',
    detail: 'Fallback macro calendar used when external calendar feeds are not configured.',
  }));
}

function json(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(data),
  };
}

async function getCalendarPayload() {
  return {
    meta: {
      mode: process.env.CALENDAR_SOURCE_URL ? 'external-or-fallback' : 'fallback',
      service: 'macro-calendar-aggregator',
    },
    updatedAt: new Date().toISOString(),
    events: buildFallbackCalendar(),
  };
}

async function handleCalendarRequest() {
  return json(await getCalendarPayload());
}

module.exports = {
  getCalendarPayload,
  handleCalendarRequest,
};
