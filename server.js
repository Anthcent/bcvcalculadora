import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getRates } from './src/rates-service.js';
import { getDb } from './src/db.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY_BYTES = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handleRates(url, res) {
  try {
    const rates = await getRates({ refresh: url.searchParams.get('refresh') === '1' });
    sendJson(res, 200, rates);
  } catch (err) {
    sendJson(res, 502, { error: 'Could not fetch rates from BCV', code: err.code ?? err.cause?.code ?? 'FETCH_ERROR', detail: err.message });
  }
}

async function handleApi(req, url, res) {
  const db = getDb();
  const { pathname } = url;

  try {
    if (pathname === '/api/rates' && req.method === 'GET') {
      return handleRates(url, res);
    }
    if (pathname === '/api/rates/history' && req.method === 'GET') {
      return sendJson(res, 200, { history: db.listBcvRates(60) });
    }
    if (pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, db.getBootstrapState());
    }
    if (pathname === '/api/custom-rate' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, db.saveCustomRate(body));
    }
    if (pathname === '/api/calculations' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, db.replaceCalculations(body) ?? { windows: [] });
    }
    if (pathname === '/api/quick-chips' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, db.saveQuickChips(body));
    }
    if (pathname === '/api/settings' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, db.saveSettings(body));
    }
    if (pathname === '/api/receipts' && req.method === 'GET') {
      return sendJson(res, 200, { receipts: db.listReceipts(30) });
    }
    if (pathname === '/api/receipts' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 201, db.saveReceipt(body));
    }
    const delMatch = pathname.match(/^\/api\/receipts\/(\d+)$/);
    if (delMatch && req.method === 'DELETE') {
      const deleted = db.deleteReceipt(Number(delMatch[1]));
      return sendJson(res, deleted ? 200 : 404, { deleted });
    }

    return sendJson(res, 404, { error: 'API endpoint not found' });
  } catch (err) {
    const status = err.status || 400;
    return sendJson(res, status, { error: err.message });
  }
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  // Block path traversal outside the public directory.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const type = MIME[path.extname(filePath)] ?? 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (relative === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, url, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  return serveStatic(url.pathname, res);
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// Initialize SQLite database eagerly on startup so schema is ready immediately.
getDb();

server.listen(PORT, HOST, () => {
  console.log(`BCV calc running at http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`On your phone (same Wi-Fi): http://${ip}:${PORT}`);
});
