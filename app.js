const { createChart, CandlestickSeries, HistogramSeries, LineSeries } = window.LightweightCharts;

const state = {
  exchange: 'coinbase',
  symbol: 'BTC',
  interval: '1h',
  charts: {},
  series: {},
  ws: null,
  wsHeartbeat: null,
  alerts: loadAlerts(),
  previousOI: null,
  lastPayload: null,
};

const el = {
  exchangeSelect: document.getElementById('exchangeSelect'),
  symbolSelect: document.getElementById('symbolSelect'),
  intervalSelect: document.getElementById('intervalSelect'),
  refreshButton: document.getElementById('refreshButton'),
  copyDeployButton: document.getElementById('copyDeployButton'),
  saveAlertsButton: document.getElementById('saveAlertsButton'),
  dataModePill: document.getElementById('dataModePill'),
  wsStatusPill: document.getElementById('wsStatusPill'),
  lastUpdatedLabel: document.getElementById('lastUpdatedLabel'),
  refreshCountdown: document.getElementById('refreshCountdown'),
  selectedMarketLabel: document.getElementById('selectedMarketLabel'),
  sourceSummary: document.getElementById('sourceSummary'),
  streamSummary: document.getElementById('streamSummary'),
  calendarMode: document.getElementById('calendarMode'),
  pricePanelTitle: document.getElementById('pricePanelTitle'),
  rangeSummary: document.getElementById('rangeSummary'),
  selectedPrice: document.getElementById('selectedPrice'),
  selectedChange: document.getElementById('selectedChange'),
  selectedOI: document.getElementById('selectedOI'),
  selectedFunding: document.getElementById('selectedFunding'),
  putCallRatio: document.getElementById('putCallRatio'),
  optionsDistribution: document.getElementById('optionsDistribution'),
  alertsList: document.getElementById('alertsList'),
  calendarList: document.getElementById('calendarList'),
  calendarSourcePill: document.getElementById('calendarSourcePill'),
  rsiUpperInput: document.getElementById('rsiUpperInput'),
  rsiLowerInput: document.getElementById('rsiLowerInput'),
  fundingThresholdInput: document.getElementById('fundingThresholdInput'),
  oiJumpInput: document.getElementById('oiJumpInput'),
};

function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem('crypto-alert-rules')) || { rsiUpper: 70, rsiLower: 30, fundingThreshold: 0.05, oiJumpThreshold: 8 };
  } catch {
    return { rsiUpper: 70, rsiLower: 30, fundingThreshold: 0.05, oiJumpThreshold: 8 };
  }
}

function saveAlerts() {
  localStorage.setItem('crypto-alert-rules', JSON.stringify(state.alerts));
}

function fmtCurrency(value, digits = 2) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(Number(value || 0));
}
function fmtCompact(value) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value || 0));
}
function fmtPercent(value, digits = 2) {
  const num = Number(value || 0);
  return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}%`;
}
function fmtFunding(value) {
  return `${(Number(value || 0) * 100).toFixed(4)}%`;
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  let prev = values[0] || 0;
  return values.map((value, index) => {
    if (!index) return prev;
    prev = (value - prev) * multiplier + prev;
    return prev;
  });
}

function sma(values, period) {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - period + 1), index + 1);
    return slice.reduce((sum, n) => sum + n, 0) / slice.length;
  });
}

function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, index) => ema12[index] - ema26[index]);
  const signal = ema(macdLine, 9);
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const avgGain = sma(gains, 14);
  const avgLoss = sma(losses, 14);
  let k = 50;
  let d = 50;
  const kdj = candles.map((item, index) => {
    const slice = candles.slice(Math.max(0, index - 8), index + 1);
    const high = Math.max(...slice.map((row) => row.high));
    const low = Math.min(...slice.map((row) => row.low));
    const rsv = high === low ? 50 : ((item.close - low) / (high - low)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    return { time: item.time, k, d, j: 3 * k - 2 * d };
  });
  return {
    macd: candles.map((item, index) => ({ time: item.time, macd: macdLine[index], signal: signal[index], histogram: macdLine[index] - signal[index] })),
    rsi: candles.map((item, index) => {
      const rs = avgLoss[index] === 0 ? 100 : avgGain[index] / avgLoss[index];
      return { time: item.time, value: 100 - 100 / (1 + rs) };
    }),
    kdj,
  };
}

function baseChart(container, height) {
  return createChart(container, {
    height,
    layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontFamily: 'Inter, sans-serif' },
    grid: { vertLines: { color: 'rgba(148,163,184,0.08)' }, horzLines: { color: 'rgba(148,163,184,0.08)' } },
    rightPriceScale: { borderColor: 'rgba(148,163,184,0.14)' },
    timeScale: { borderColor: 'rgba(148,163,184,0.14)', timeVisible: true },
  });
}

function initCharts() {
  state.charts.price = baseChart(document.getElementById('candlestickChart'), 360);
  state.series.candles = state.charts.price.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#fb7185', wickUpColor: '#22c55e', wickDownColor: '#fb7185', borderVisible: false });
  state.charts.volume = baseChart(document.getElementById('volumeChart'), 120);
  state.series.volume = state.charts.volume.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
  state.charts.macd = baseChart(document.getElementById('macdChart'), 160);
  state.series.macdHistogram = state.charts.macd.addSeries(HistogramSeries, {});
  state.series.macd = state.charts.macd.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2 });
  state.series.signal = state.charts.macd.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 2 });
  state.charts.rsi = baseChart(document.getElementById('rsiChart'), 160);
  state.series.rsi = state.charts.rsi.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2 });
  state.charts.kdj = baseChart(document.getElementById('kdjChart'), 160);
  state.series.k = state.charts.kdj.addSeries(LineSeries, { color: '#22c55e', lineWidth: 2 });
  state.series.d = state.charts.kdj.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 2 });
  state.series.j = state.charts.kdj.addSeries(LineSeries, { color: '#f97316', lineWidth: 2 });
  state.charts.oi = baseChart(document.getElementById('oiChart'), 220);
  state.series.oi = state.charts.oi.addSeries(HistogramSeries, { color: '#f7931a' });

  const charts = [state.charts.price, state.charts.volume, state.charts.macd, state.charts.rsi, state.charts.kdj];
  charts.forEach((chart) => {
    chart.subscribeCrosshairMove((param) => syncCrosshair(chart, param));
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => syncRange(chart, range));
  });
  window.addEventListener('resize', resizeCharts);
  resizeCharts();
}

let syncingCrosshair = false;
let syncingRange = false;
function syncRange(source, range) {
  if (syncingRange || !range) return;
  syncingRange = true;
  Object.values(state.charts).forEach((chart) => { if (chart !== source && chart.timeScale) chart.timeScale().setVisibleLogicalRange(range); });
  syncingRange = false;
}
function syncCrosshair(source, param) {
  if (syncingCrosshair || !param?.time) return;
  syncingCrosshair = true;
  Object.values(state.charts).forEach((chart) => {
    if (chart !== source && chart.setCrosshairPosition) {
      chart.setCrosshairPosition(param.point?.x ?? 0, param.point?.y ?? 0, state.series.candles);
    }
  });
  syncingCrosshair = false;
}

function resizeCharts() {
  [['price','candlestickChart'],['volume','volumeChart'],['macd','macdChart'],['rsi','rsiChart'],['kdj','kdjChart'],['oi','oiChart']].forEach(([key, id]) => {
    const node = document.getElementById(id);
    if (state.charts[key] && node) state.charts[key].applyOptions({ width: node.clientWidth });
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDashboard() {
  const payload = await fetchJson(`/api/dashboard?exchange=${state.exchange}&symbol=${state.symbol}&interval=${state.interval}`);
  state.lastPayload = payload;
  renderDashboard(payload);
  connectMarketStream(payload.exchangeInfo?.ws);
  evaluateAlerts(payload);
}

async function loadCalendar() {
  const payload = await fetchJson('/api/calendar');
  el.calendarSourcePill.textContent = payload.meta.service;
  el.calendarMode.textContent = payload.meta.mode;
  el.calendarList.innerHTML = payload.events.map((event) => `
    <article>
      <time>${new Date(event.scheduledAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
      <div><h3>${event.event}</h3><p>${event.region} · ${event.detail}</p></div>
      <span class="impact ${event.impact}">${event.impact}</span>
    </article>`).join('');
}

function renderDashboard(payload) {
  renderOverview(payload.overview);
  renderSelected(payload);
  renderCharts(payload);
  renderOptions(payload.optionsDistribution);
  renderMeta(payload);
}

function renderOverview(overview) {
  [['BTC','btc'],['ETH','eth']].forEach(([key,prefix]) => {
    const data = overview[key];
    document.getElementById(`${prefix}Price`).textContent = fmtCurrency(data.price, data.price > 1000 ? 0 : 2);
    document.getElementById(`${prefix}Change`).textContent = fmtPercent(data.changePct);
    document.getElementById(`${prefix}High`).textContent = fmtCurrency(data.high24h, 0);
    document.getElementById(`${prefix}Low`).textContent = fmtCurrency(data.low24h, 0);
    document.getElementById(`${prefix}Volume`).textContent = fmtCompact(data.volume24h);
  });
}

function renderSelected(payload) {
  const market = payload.selectedMarket;
  el.selectedMarketLabel.textContent = `${payload.exchangeInfo.label} · ${market.symbol} · ${payload.meta.interval.toUpperCase()}`;
  el.pricePanelTitle.textContent = `${payload.exchangeInfo.label} ${market.symbol} 主图`;
  el.rangeSummary.textContent = `24H High ${fmtCurrency(market.high24h, 0)} / Low ${fmtCurrency(market.low24h, 0)}`;
  el.selectedPrice.textContent = fmtCurrency(market.price, market.price > 1000 ? 0 : 2);
  el.selectedChange.textContent = fmtPercent(market.changePct);
  el.selectedOI.textContent = fmtCompact(market.oiTotal);
  el.selectedFunding.textContent = fmtFunding(market.fundingRate);
  el.putCallRatio.textContent = Number(market.putCallRatio || 0).toFixed(2);
  document.querySelectorAll('[data-symbol-card]').forEach((card) => card.classList.toggle('active', card.dataset.symbolCard === market.symbol));
}

function renderCharts(payload) {
  const candles = payload.candles;
  const indicators = computeIndicators(candles);
  state.series.candles.setData(candles);
  state.series.volume.setData(candles.map((item) => ({ time: item.time, value: item.volume, color: item.close >= item.open ? 'rgba(34,197,94,0.85)' : 'rgba(251,113,133,0.85)' })));
  state.series.macdHistogram.setData(indicators.macd.map((item) => ({ time: item.time, value: item.histogram, color: item.histogram >= 0 ? '#22c55e' : '#fb7185' })));
  state.series.macd.setData(indicators.macd.map((item) => ({ time: item.time, value: item.macd })));
  state.series.signal.setData(indicators.macd.map((item) => ({ time: item.time, value: item.signal })));
  state.series.rsi.setData(indicators.rsi);
  state.series.k.setData(indicators.kdj.map((item) => ({ time: item.time, value: item.k })));
  state.series.d.setData(indicators.kdj.map((item) => ({ time: item.time, value: item.d })));
  state.series.j.setData(indicators.kdj.map((item) => ({ time: item.time, value: item.j })));
  state.series.oi.setData(payload.oiByInstrument.map((item, index) => ({ time: candles[0].time + index, value: item.value, color: '#f7931a' })));
  state.charts.price.timeScale().fitContent();
  state.currentIndicators = {
    rsi: indicators.rsi.at(-1)?.value || 0,
    macd: indicators.macd.at(-1) || {},
  };
}

function renderOptions(items) {
  el.optionsDistribution.innerHTML = items.map((item) => `
    <div class="live-bar ${item.isAtMoney ? 'highlight' : ''}">
      <span>${Math.round(item.strike / 1000)}k</span>
      <b style="height:${Math.max(item.normalized * 100, 12)}%"></b>
      <small>${fmtCompact(item.value)}</small>
    </div>`).join('');
}

function renderMeta(payload) {
  el.dataModePill.textContent = payload.meta.mode === 'live' ? 'LIVE 数据' : 'DEMO 回退';
  el.dataModePill.className = `pill ${payload.meta.mode === 'live' ? 'live' : 'warning'}`;
  el.lastUpdatedLabel.textContent = `最后更新：${fmtTime(payload.updatedAt)}`;
  el.sourceSummary.textContent = `${payload.sources.price} / ${payload.sources.derivatives}`;
  el.streamSummary.textContent = payload.exchangeInfo?.ws ? `${payload.exchangeInfo.label} WebSocket + 本地心跳` : '仅快照';
  el.refreshCountdown.textContent = payload.meta.mode === 'live' ? 'streaming' : 'fallback';
}

function connectMarketStream(wsConfig) {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  connectHeartbeatChannel();
  if (!wsConfig) return;
  try {
    const ws = new WebSocket(wsConfig.url);
    state.ws = ws;
    ws.onopen = () => {
      el.wsStatusPill.textContent = 'WS 已连接';
      el.wsStatusPill.className = 'pill live';
      if (wsConfig.subscribe) ws.send(JSON.stringify(wsConfig.subscribe));
    };
    ws.onmessage = (event) => applyStreamMessage(wsConfig.parser, event.data);
    ws.onerror = () => {
      el.wsStatusPill.textContent = 'WS 异常';
      el.wsStatusPill.className = 'pill warning';
    };
    ws.onclose = () => {
      el.wsStatusPill.textContent = 'WS 已断开';
      el.wsStatusPill.className = 'pill subtle';
    };
  } catch {
    el.wsStatusPill.textContent = 'WS 不可用';
    el.wsStatusPill.className = 'pill warning';
  }
}

function connectHeartbeatChannel() {
  if (state.wsHeartbeat) state.wsHeartbeat.close();
  try {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    state.wsHeartbeat = ws;
  } catch {}
}

function applyStreamMessage(parser, raw) {
  if (!state.lastPayload) return;
  let message;
  try { message = JSON.parse(raw); } catch { return; }
  let nextPrice = null;
  if (parser === 'coinbaseTicker') nextPrice = Number(message.price);
  if (parser === 'binanceTicker') nextPrice = Number(message.c);
  if (parser === 'okxTicker') nextPrice = Number(message.data?.[0]?.last);
  if (parser === 'bybitTicker') nextPrice = Number(message.data?.lastPrice);
  if (!Number.isFinite(nextPrice)) return;
  state.lastPayload.selectedMarket.price = nextPrice;
  state.lastPayload.overview[state.symbol].price = nextPrice;
  el.selectedPrice.textContent = fmtCurrency(nextPrice, nextPrice > 1000 ? 0 : 2);
  document.getElementById(`${state.symbol.toLowerCase()}Price`).textContent = fmtCurrency(nextPrice, nextPrice > 1000 ? 0 : 2);
  el.wsStatusPill.textContent = 'WS 流式更新中';
  el.wsStatusPill.className = 'pill live';
}

function evaluateAlerts(payload) {
  const alerts = [];
  const currentRSI = state.currentIndicators?.rsi || 0;
  const fundingPct = Number(payload.selectedMarket.fundingRate || 0) * 100;
  const oiNow = Number(payload.selectedMarket.oiTotal || 0);
  if (currentRSI >= Number(state.alerts.rsiUpper)) alerts.push(`RSI 高于阈值：${currentRSI.toFixed(2)} ≥ ${state.alerts.rsiUpper}`);
  if (currentRSI <= Number(state.alerts.rsiLower)) alerts.push(`RSI 低于阈值：${currentRSI.toFixed(2)} ≤ ${state.alerts.rsiLower}`);
  if (Math.abs(fundingPct) >= Number(state.alerts.fundingThreshold)) alerts.push(`Funding 异常：${fundingPct.toFixed(4)}%`);
  if (state.previousOI) {
    const oiJump = ((oiNow - state.previousOI) / state.previousOI) * 100;
    if (Math.abs(oiJump) >= Number(state.alerts.oiJumpThreshold)) alerts.push(`OI 波动超过阈值：${oiJump.toFixed(2)}%`);
  }
  state.previousOI = oiNow;
  el.alertsList.innerHTML = alerts.length ? alerts.map((item) => `<li><span>触发</span><strong>${item}</strong></li>`).join('') : '<li><span>状态</span><strong>当前没有触发预警</strong></li>';
}

function registerEvents() {
  el.exchangeSelect.addEventListener('change', () => { state.exchange = el.exchangeSelect.value; loadDashboard(); });
  el.symbolSelect.addEventListener('change', () => { state.symbol = el.symbolSelect.value; loadDashboard(); });
  el.intervalSelect.addEventListener('change', () => { state.interval = el.intervalSelect.value; loadDashboard(); });
  el.refreshButton.addEventListener('click', () => loadDashboard());
  el.copyDeployButton.addEventListener('click', async () => {
    const message = ['npm start', 'vercel --prod', 'netlify deploy --prod'].join('\n');
    await navigator.clipboard.writeText(message);
    el.copyDeployButton.textContent = '已复制';
    setTimeout(() => { el.copyDeployButton.textContent = '复制部署命令'; }, 1500);
  });
  document.querySelectorAll('[data-symbol-card]').forEach((card) => card.addEventListener('click', () => {
    state.symbol = card.dataset.symbolCard;
    el.symbolSelect.value = state.symbol;
    loadDashboard();
  }));
  el.saveAlertsButton.addEventListener('click', () => {
    state.alerts = {
      rsiUpper: Number(el.rsiUpperInput.value),
      rsiLower: Number(el.rsiLowerInput.value),
      fundingThreshold: Number(el.fundingThresholdInput.value),
      oiJumpThreshold: Number(el.oiJumpInput.value),
    };
    saveAlerts();
    evaluateAlerts(state.lastPayload || { selectedMarket: { fundingRate: 0, oiTotal: 0 } });
  });
}

function fillAlertInputs() {
  el.rsiUpperInput.value = state.alerts.rsiUpper;
  el.rsiLowerInput.value = state.alerts.rsiLower;
  el.fundingThresholdInput.value = state.alerts.fundingThreshold;
  el.oiJumpInput.value = state.alerts.oiJumpThreshold;
}

initCharts();
fillAlertInputs();
registerEvents();
loadDashboard();
loadCalendar();
