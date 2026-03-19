const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { handleDashboardRequest } = require('./lib/market-data');
const { handleCalendarRequest } = require('./lib/calendar-data');

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function writeWebSocketFrame(socket, payload) {
  const data = Buffer.from(payload);
  const frame = Buffer.alloc(data.length + 2);
  frame[0] = 0x81;
  frame[1] = data.length;
  data.copy(frame, 2);
  socket.write(frame);
}

function attachWebSocket(server) {
  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'binary')
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));

    const sendHeartbeat = () => {
      writeWebSocketFrame(socket, JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
    };
    const interval = setInterval(sendHeartbeat, 15000);
    sendHeartbeat();

    socket.on('close', () => clearInterval(interval));
    socket.on('end', () => clearInterval(interval));
    socket.on('error', () => clearInterval(interval));
    socket.on('data', () => {});
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/dashboard' || url.pathname === '/.netlify/functions/dashboard') {
    const response = await handleDashboardRequest({ url: url.toString(), path: req.url });
    Object.entries(response.headers).forEach(([key, value]) => res.setHeader(key, value));
    res.statusCode = response.statusCode;
    res.end(response.body);
    return;
  }

  if (url.pathname === '/api/calendar' || url.pathname === '/.netlify/functions/calendar') {
    const response = await handleCalendarRequest();
    Object.entries(response.headers).forEach(([key, value]) => res.setHeader(key, value));
    res.statusCode = response.statusCode;
    res.end(response.body);
    return;
  }

  const safePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buffer);
  });
});

attachWebSocket(server);
server.listen(PORT, () => {
  console.log(`Dashboard running at http://127.0.0.1:${PORT}`);
});
