const fs = require('fs');
const path = require('path');

const DEMO_DATA_PATH = path.join(__dirname, 'demo-data.json');
const DEMO_DATA = JSON.parse(fs.readFileSync(DEMO_DATA_PATH, 'utf8'));

const EXCHANGE_CONFIG = {
  coinbase: {
    label: 'Coinbase',
    supportsFunding: false,
    supportsOI: false,
    ws: {
      mode: 'direct',
      url: 'wss://ws-feed.exchange.coinbase.com',
    },
  },
  binance: {
    label: 'Binance',
    supportsFunding: true,
    supportsOI: true,
    ws: {
      mode: 'direct',
      url: 'wss://stream.binance.com:9443/ws',
    },
  },
  okx: {
    label: 'OKX',
    supportsFunding: true,
    supportsOI: true,
    ws: {
      mode: 'direct',
      url: 'wss://ws.okx.com:8443/ws/v5/public',
    },
  },
  bybit: {
    label: 'Bybit',
    supportsFunding: true,
    supportsOI: true,
    ws: {
      mode: 'direct',
      url: 'wss://stream.bybit.com/v5/public/spot',
    },
  },
};

const SYMBOL_MAP = {
  BTC: {
    label: 'Bitcoin',
    deribitCurrency: 'BTC',
    perpetualInstrument: 'BTC-PERPETUAL',
    exchanges: {
      coinbase: { product: 'BTC-USD' },
      binance: { spotSymbol: 'BTCUSDT', futuresSymbol: 'BTCUSDT' },
      okx: { spotSymbol: 'BTC-USDT', swapSymbol: 'BTC-USDT-SWAP' },
      bybit: { spotSymbol: 'BTCUSDT', futuresSymbol: 'BTCUSDT' },
    },
  },
  ETH: {
    label: 'Ethereum',
    deribitCurrency: 'ETH',
    perpetualInstrument: 'ETH-PERPETUAL',
    exchanges: {
      coinbase: { product: 'ETH-USD' },
      binance: { spotSymbol: 'ETHUSDT', futuresSymbol: 'ETHUSDT' },
      okx: { spotSymbol: 'ETH-USDT', swapSymbol: 'ETH-USDT-SWAP' },
      bybit: { spotSymbol: 'ETHUSDT', futuresSymbol: 'ETHUSDT' },
    },
  },
};

const INTERVAL_MAP = {
  '15m': { seconds: 900, candles: 160, okx: '15m', bybit: '15', binance: '15m' },
  '1h': { seconds: 3600, candles: 180, okx: '1H', bybit: '60', binance: '1h' },
  '4h': { seconds: 14400, candles: 180, okx: '4H', bybit: '240', binance: '4h' },
  '1d': { seconds: 86400, candles: 180, okx: '1D', bybit: 'D', binance: '1d' },
};

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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'GPT-5.2-Codex crypto dashboard',
      accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Upstream ${response.status} for ${url}`);
  return response.json();
}

function shapeCandlesFromRows(rows, mapper) {
  return rows.map(mapper).filter(Boolean).sort((a, b) => a.time - b.time);
}

function shapeCoinbaseCandles(rawCandles) {
  return shapeCandlesFromRows(rawCandles, (entry) => ({
    time: Number(entry[0]),
    low: Number(entry[1]),
    high: Number(entry[2]),
    open: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  }));
}

function shapeBinanceCandles(rawCandles) {
  return shapeCandlesFromRows(rawCandles, (entry) => ({
    time: Math.floor(Number(entry[0]) / 1000),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  }));
}

function shapeOkxCandles(rawCandles) {
  return shapeCandlesFromRows(rawCandles, (entry) => ({
    time: Math.floor(Number(entry[0]) / 1000),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
  }));
}

function shapeBybitCandles(rawCandles) {
  return shapeCandlesFromRows(rawCandles, (entry) => ({
    time: Math.floor(Number(entry.start || entry[0]) / 1000),
    open: Number(entry.open || entry[1]),
    high: Number(entry.high || entry[2]),
    low: Number(entry.low || entry[3]),
    close: Number(entry.close || entry[4]),
    volume: Number(entry.volume || entry[5]),
  }));
}

function formatLiveError(exchange, error) {
  return `${EXCHANGE_CONFIG[exchange]?.label || exchange}: ${error.message}`;
}

async function loadCoinbaseSnapshot(symbol, interval) {
  const product = SYMBOL_MAP[symbol].exchanges.coinbase.product;
  const timeframe = INTERVAL_MAP[interval];
  const end = Math.floor(Date.now() / 1000);
  const start = end - timeframe.seconds * timeframe.candles;
  const base = 'https://api.exchange.coinbase.com/products';
  const [candles, ticker, stats] = await Promise.all([
    fetchJson(`${base}/${product}/candles?granularity=${timeframe.seconds}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`),
    fetchJson(`${base}/${product}/ticker`),
    fetchJson(`${base}/${product}/stats`),
  ]);
  const shaped = shapeCoinbaseCandles(candles);
  const price = Number(ticker.price || shaped.at(-1)?.close || 0);
  const open24h = Number(stats.open || price);
  return {
    price,
    changePct: open24h ? ((price - open24h) / open24h) * 100 : 0,
    volume24h: Number(stats.volume || 0),
    high24h: Number(stats.high || 0),
    low24h: Number(stats.low || 0),
    candles: shaped,
    fundingRate: 0,
    oiTotal: 0,
    wsHint: { exchange: 'coinbase', symbol },
  };
}

async function loadBinanceSnapshot(symbol, interval) {
  const config = SYMBOL_MAP[symbol].exchanges.binance;
  const tf = INTERVAL_MAP[interval];
  const [ticker, candles, funding, oi] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${config.spotSymbol}`),
    fetchJson(`https://api.binance.com/api/v3/klines?symbol=${config.spotSymbol}&interval=${tf.binance}&limit=${tf.candles}`),
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${config.futuresSymbol}`),
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${config.futuresSymbol}`),
  ]);
  return {
    price: Number(ticker.lastPrice || 0),
    changePct: Number(ticker.priceChangePercent || 0),
    volume24h: Number(ticker.volume || 0),
    high24h: Number(ticker.highPrice || 0),
    low24h: Number(ticker.lowPrice || 0),
    candles: shapeBinanceCandles(candles),
    fundingRate: Number(funding.lastFundingRate || 0),
    oiTotal: Number(oi.openInterest || 0),
    wsHint: { exchange: 'binance', symbol: config.spotSymbol },
  };
}

async function loadOkxSnapshot(symbol, interval) {
  const config = SYMBOL_MAP[symbol].exchanges.okx;
  const tf = INTERVAL_MAP[interval];
  const [ticker, candles, funding, oi] = await Promise.all([
    fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${config.spotSymbol}`),
    fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${config.spotSymbol}&bar=${tf.okx}&limit=${tf.candles}`),
    fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${config.swapSymbol}`),
    fetchJson(`https://www.okx.com/api/v5/public/open-interest?instId=${config.swapSymbol}`),
  ]);
  const tickerRow = ticker.data?.[0] || {};
  return {
    price: Number(tickerRow.last || 0),
    changePct: Number(tickerRow.sodUtc0 ? ((Number(tickerRow.last || 0) - Number(tickerRow.sodUtc0 || 0)) / Number(tickerRow.sodUtc0 || 1)) * 100 : 0),
    volume24h: Number(tickerRow.vol24h || 0),
    high24h: Number(tickerRow.high24h || 0),
    low24h: Number(tickerRow.low24h || 0),
    candles: shapeOkxCandles(candles.data || []),
    fundingRate: Number(funding.data?.[0]?.fundingRate || 0),
    oiTotal: Number(oi.data?.[0]?.oi || 0),
    wsHint: { exchange: 'okx', symbol: config.spotSymbol },
  };
}

async function loadBybitSnapshot(symbol, interval) {
  const config = SYMBOL_MAP[symbol].exchanges.bybit;
  const tf = INTERVAL_MAP[interval];
  const [ticker, candles, funding, oi] = await Promise.all([
    fetchJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${config.spotSymbol}`),
    fetchJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${config.spotSymbol}&interval=${tf.bybit}&limit=${tf.candles}`),
    fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${config.futuresSymbol}`),
    fetchJson(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${config.futuresSymbol}&intervalTime=5min&limit=1`),
  ]);
  const spot = ticker.result?.list?.[0] || {};
  const linear = funding.result?.list?.[0] || {};
  const lastOi = oi.result?.list?.[0] || {};
  return {
    price: Number(spot.lastPrice || 0),
    changePct: Number(spot.price24hPcnt || 0) * 100,
    volume24h: Number(spot.volume24h || 0),
    high24h: Number(spot.highPrice24h || 0),
    low24h: Number(spot.lowPrice24h || 0),
    candles: shapeBybitCandles(candles.result?.list || []),
    fundingRate: Number(linear.fundingRate || 0),
    oiTotal: Number(lastOi.openInterest || linear.openInterest || 0),
    wsHint: { exchange: 'bybit', symbol: config.spotSymbol },
  };
}

const EXCHANGE_LOADERS = {
  coinbase: loadCoinbaseSnapshot,
  binance: loadBinanceSnapshot,
  okx: loadOkxSnapshot,
  bybit: loadBybitSnapshot,
};

function aggregateOptionsByStrike(options, price) {
  const buckets = new Map();
  for (const item of options) {
    const parts = String(item.instrument_name || '').split('-');
    if (parts.length < 4) continue;
    const strike = Number(parts[2]);
    if (!Number.isFinite(strike)) continue;
    const amount = Number(item.open_interest || item.volume_usd || item.volume || 0);
    buckets.set(strike, (buckets.get(strike) || 0) + amount);
  }
  const sorted = [...buckets.entries()].map(([strike, value]) => ({ strike, value })).sort((a, b) => a.strike - b.strike);
  if (!sorted.length) return [];
  const nearestIndex = sorted.reduce((best, current, index) => (
    Math.abs(current.strike - price) < Math.abs(sorted[best].strike - price) ? index : best
  ), 0);
  const windowed = sorted.slice(Math.max(0, nearestIndex - 4), Math.min(sorted.length, nearestIndex + 5));
  const maxValue = Math.max(...windowed.map((item) => item.value), 1);
  return windowed.map((item) => ({
    strike: item.strike,
    value: item.value,
    normalized: item.value / maxValue,
    isAtMoney: item.strike === windowed.reduce((closest, row) => Math.abs(row.strike - price) < Math.abs(closest - price) ? row.strike : closest, windowed[0].strike),
  }));
}

function computePutCallRatio(options) {
  let puts = 0;
  let calls = 0;
  for (const item of options) {
    const amount = Number(item.open_interest || 0);
    if (String(item.instrument_name || '').endsWith('-P')) puts += amount;
    if (String(item.instrument_name || '').endsWith('-C')) calls += amount;
  }
  return calls ? puts / calls : 0;
}

async function loadDeribitSnapshot(symbol, price) {
  const config = SYMBOL_MAP[symbol];
  const base = 'https://www.deribit.com/api/v2/public';
  const [futureSummary, optionSummary, perpetualTicker] = await Promise.all([
    fetchJson(`${base}/get_book_summary_by_currency?currency=${config.deribitCurrency}&kind=future`),
    fetchJson(`${base}/get_book_summary_by_currency?currency=${config.deribitCurrency}&kind=option`),
    fetchJson(`${base}/ticker?instrument_name=${config.perpetualInstrument}`),
  ]);
  const futures = (futureSummary.result || []).map((row) => ({
    instrument: row.instrument_name,
    openInterest: Number(row.open_interest || 0),
  }));
  return {
    oiByInstrument: futures.sort((a, b) => b.openInterest - a.openInterest).slice(0, 6).map((row) => ({
      label: row.instrument.replace(`${symbol}-`, ''),
      value: row.openInterest,
    })).reverse(),
    optionsDistribution: aggregateOptionsByStrike(optionSummary.result || [], price),
    optionPutCallRatio: computePutCallRatio(optionSummary.result || []),
    fundingRate: Number(perpetualTicker.result?.current_funding || perpetualTicker.result?.funding_8h || 0),
    basis: Number(perpetualTicker.result?.mark_price || 0) - Number(perpetualTicker.result?.index_price || 0),
  };
}

function buildWsInfo(exchange, symbol) {
  const ws = EXCHANGE_CONFIG[exchange]?.ws;
  const exchangeSymbol = SYMBOL_MAP[symbol].exchanges[exchange];
  if (!ws || !exchangeSymbol) return null;
  if (exchange === 'coinbase') {
    return {
      ...ws,
      subscribe: {
        type: 'subscribe',
        channels: [{ name: 'ticker', product_ids: [exchangeSymbol.product] }],
      },
      parser: 'coinbaseTicker',
    };
  }
  if (exchange === 'binance') {
    return {
      ...ws,
      url: `${ws.url}/${exchangeSymbol.spotSymbol.toLowerCase()}@ticker`,
      parser: 'binanceTicker',
    };
  }
  if (exchange === 'okx') {
    return {
      ...ws,
      subscribe: {
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: exchangeSymbol.spotSymbol }],
      },
      parser: 'okxTicker',
    };
  }
  if (exchange === 'bybit') {
    return {
      ...ws,
      subscribe: {
        op: 'subscribe',
        args: [`tickers.${exchangeSymbol.spotSymbol}`],
      },
      parser: 'bybitTicker',
    };
  }
  return null;
}

function formatErrorPayload(exchange, symbol, interval, error) {
  const fallback = JSON.parse(JSON.stringify(DEMO_DATA));
  fallback.meta.mode = 'demo-fallback';
  fallback.meta.warning = error.message;
  fallback.meta.exchange = exchange;
  fallback.meta.selectedSymbol = symbol;
  fallback.meta.interval = interval;
  fallback.selectedMarket.symbol = symbol;
  fallback.selectedMarket.name = SYMBOL_MAP[symbol].label;
  fallback.updatedAt = new Date().toISOString();
  fallback.exchange = exchange;
  fallback.exchangeInfo = {
    current: exchange,
    available: Object.entries(EXCHANGE_CONFIG).map(([key, value]) => ({ key, label: value.label })),
    ws: buildWsInfo(exchange, symbol),
  };
  return fallback;
}

async function getOverview(interval, preferredExchange) {
  const [btc, eth] = await Promise.all([
    EXCHANGE_LOADERS[preferredExchange]('BTC', interval),
    EXCHANGE_LOADERS[preferredExchange]('ETH', interval),
  ]);
  return {
    BTC: { symbol: 'BTC', name: SYMBOL_MAP.BTC.label, price: btc.price, changePct: btc.changePct, volume24h: btc.volume24h, high24h: btc.high24h, low24h: btc.low24h },
    ETH: { symbol: 'ETH', name: SYMBOL_MAP.ETH.label, price: eth.price, changePct: eth.changePct, volume24h: eth.volume24h, high24h: eth.high24h, low24h: eth.low24h },
  };
}

async function getDashboardPayload(symbol = 'BTC', interval = '1h', exchange = 'coinbase') {
  const safeSymbol = SYMBOL_MAP[symbol] ? symbol : 'BTC';
  const safeInterval = INTERVAL_MAP[interval] ? interval : '1h';
  const safeExchange = EXCHANGE_CONFIG[exchange] ? exchange : 'coinbase';

  try {
    const [overview, selectedMarket] = await Promise.all([
      getOverview(safeInterval, safeExchange),
      EXCHANGE_LOADERS[safeExchange](safeSymbol, safeInterval),
    ]);

    const finalPrice = selectedMarket.price || DEMO_DATA.selectedMarket.price;
    const derivativeSnapshot = await loadDeribitSnapshot(safeSymbol, finalPrice);

    return {
      meta: {
        mode: 'live',
        interval: safeInterval,
        selectedSymbol: safeSymbol,
        exchange: safeExchange,
      },
      updatedAt: new Date().toISOString(),
      overview,
      selectedMarket: {
        symbol: safeSymbol,
        name: SYMBOL_MAP[safeSymbol].label,
        price: selectedMarket.price,
        changePct: selectedMarket.changePct,
        volume24h: selectedMarket.volume24h,
        high24h: selectedMarket.high24h,
        low24h: selectedMarket.low24h,
        fundingRate: selectedMarket.fundingRate || derivativeSnapshot.fundingRate,
        oiTotal: selectedMarket.oiTotal || derivativeSnapshot.oiByInstrument.reduce((sum, row) => sum + row.value, 0),
        basis: derivativeSnapshot.basis,
        putCallRatio: derivativeSnapshot.optionPutCallRatio,
      },
      candles: selectedMarket.candles,
      oiByInstrument: derivativeSnapshot.oiByInstrument,
      optionsDistribution: derivativeSnapshot.optionsDistribution,
      exchangeInfo: {
        current: safeExchange,
        label: EXCHANGE_CONFIG[safeExchange].label,
        available: Object.entries(EXCHANGE_CONFIG).map(([key, value]) => ({ key, label: value.label })),
        ws: buildWsInfo(safeExchange, safeSymbol),
      },
      sources: {
        price: `${EXCHANGE_CONFIG[safeExchange].label} public market data`,
        derivatives: 'Deribit public market data',
        calendar: 'Internal calendar service',
      },
      alertsContext: {
        exchangeFundingSupported: EXCHANGE_CONFIG[safeExchange].supportsFunding,
        exchangeOISupported: EXCHANGE_CONFIG[safeExchange].supportsOI,
      },
    };
  } catch (error) {
    return formatErrorPayload(safeExchange, safeSymbol, safeInterval, new Error(formatLiveError(safeExchange, error)));
  }
}

async function handleDashboardRequest(event) {
  const url = new URL(event.url || `http://localhost${event.path || '/api/dashboard'}`);
  const symbol = (url.searchParams.get('symbol') || 'BTC').toUpperCase();
  const interval = url.searchParams.get('interval') || '1h';
  const exchange = (url.searchParams.get('exchange') || 'coinbase').toLowerCase();
  const payload = await getDashboardPayload(symbol, interval, exchange);
  return json(payload);
}

module.exports = {
  getDashboardPayload,
  handleDashboardRequest,
  json,
};
