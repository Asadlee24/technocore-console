/**
 * Standalone Production Server for Railway / Render / VPS
 * Runs FlopRadar Telegram Bot 24/7 with zero external npm dependencies.
 * 
 * Technocore Sonnet Challenge #2
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import botHandler from './api/bot.js';

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8814701073:AAF2gj_wL-37JyJoqA_2vTDSdPN5NwFKXI0';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health check endpoint
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>FlopRadar Bot - 24/7 Active</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #161e2e; padding: 2.5rem; border-radius: 1rem; border: 1px solid #374151; text-align: center; max-width: 480px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h1 { color: #38bdf8; margin-top: 0; }
            .status { display: inline-flex; align-items: center; gap: 8px; background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 6px 14px; border-radius: 9999px; font-weight: 600; margin-bottom: 1rem; }
            .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
            a { color: #60a5fa; text-decoration: none; font-weight: 500; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="status"><div class="dot"></div> 24/7 Active on Railway</div>
            <h1>🤖 FlopRadar Bot</h1>
            <p>Real-time companion for Technocore Sonnet Challenge #2.</p>
            <p><a href="https://t.me/FlopRadarBot" target="_blank">👉 Open in Telegram (@FlopRadarBot)</a></p>
            <p><a href="https://technocore-console.vercel.app/" target="_blank">🌐 Technocore Console</a></p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  // Telegram webhook endpoint (/api/bot)
  if (url.pathname.startsWith('/api/bot')) {
    let bodyData = '';
    req.on('data', chunk => {
      bodyData += chunk;
    });

    req.on('end', async () => {
      // Mock Express / Next-style res helpers
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };

      // Mock Express-style req fields
      req.query = Object.fromEntries(url.searchParams.entries());
      req.body = undefined;
      if (bodyData) {
        try {
          req.body = JSON.parse(bodyData);
        } catch {
          req.body = bodyData;
        }
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

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[FlopRadar] Server listening on port ${PORT}`);
  console.log(`[FlopRadar] Health check: http://localhost:${PORT}/health`);
  console.log(`[FlopRadar] Webhook: http://localhost:${PORT}/api/bot`);
});
