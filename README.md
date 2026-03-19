# BTC / ETH 专业交易监控终端

支持以下能力：

- 多交易所切换：Coinbase / Binance / OKX / Bybit
- 真正的 WebSocket 流式价格更新
- 真实 K 线、成交量、MACD、RSI、KDJ
- 持仓量结构与资金费率监控
- Deribit 期权执行价分布与 Put/Call 比
- 独立经济日历聚合接口 `/api/calendar`
- 本地自定义预警：RSI、Funding、OI 异动
- 本地预览、Vercel、Netlify 部署

## 本地预览

```bash
npm start
```

打开：

```text
http://127.0.0.1:8000
```

本地服务会同时提供：

- 静态前端
- `/api/dashboard`
- `/api/calendar`
- `/ws` 本地 WebSocket 心跳通道

## 部署

### Vercel

```bash
vercel --prod
```

### Netlify

```bash
netlify deploy --prod
```

## 数据来源

- 交易所快照：Coinbase / Binance / OKX / Bybit 公共接口
- 衍生品与期权：Deribit Public API
- 日历：独立 calendar service（当前默认 fallback 聚合，可继续接外部源）

> 如果当前环境无法访问上游交易所，`/api/dashboard` 会自动降级到 demo fallback，并在界面顶部提示。
