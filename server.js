/**
 * Standalone Production Server for Local Dev, Railway, Render, or VPS
 * Serves Technocore Console Web App, /api/proxy, and FlopRadar Telegram Bot.
 * 
 * Built by Asad Lee (@asadleo416)
 * Portfolio: https://asad-lee-portfolio.vercel.app/
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import botHandler from './api/bot.js';
import proxyHandler from './api/proxy.js';

const PORT = process.env.PORT || 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.dict': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health check endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'technocore-console',
      architect: 'Asad Lee (@asadleo416)',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Telegram webhook endpoint (/api/bot)
  if (url.pathname.startsWith('/api/bot')) {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      res.status = (code) => { res.statusCode = code; return res; };
      res.send = (data) => { res.end(data); return res; };
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
        return res;
      };
      req.query = Object.fromEntries(url.searchParams.entries());
      req.body = undefined;
      if (bodyData) {
        try { req.body = JSON.parse(bodyData); } catch { req.body = bodyData; }
      }
      try {
        await botHandler(req, res);
      } catch (err) {
        console.error('Error executing bot handler:', err);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }

  // Serverless proxy endpoint (/api/proxy)
  if (url.pathname.startsWith('/api/proxy')) {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      res.status = (code) => { res.statusCode = code; return res; };
      res.send = (data) => { res.end(data); return res; };
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
        return res;
      };
      req.query = Object.fromEntries(url.searchParams.entries());
      req.body = undefined;
      if (bodyData) {
        try { req.body = JSON.parse(bodyData); } catch { req.body = bodyData; }
      }
      try {
        await proxyHandler(req, res);
      } catch (err) {
        console.error('Error executing proxy handler:', err);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }

  // Static File Serving (index.html, app.js, style.css, vendor files, etc.)
  let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  // Prevent directory traversal
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(process.cwd(), safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('=============================================================');
  console.log(`🌐 Technocore Console & FlopRadar running on http://localhost:${PORT}`);
  console.log(`⚡ Architect: Asad Lee (@asadleo416)`);
  console.log(`📡 Proxy: http://localhost:${PORT}/api/proxy`);
  console.log(`🤖 Bot Webhook: http://localhost:${PORT}/api/bot`);
  console.log('=============================================================');
});
