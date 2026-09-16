/**
 * FlopRadar Telegram Bot - 24/7 Standalone Long-Polling Daemon
 * Powered by Asad Lee (@asadleo416)
 *
 * Runs locally or on VPS/Railway with zero webhook configuration.
 * Usage: node bot_poller.mjs
 */

import botHandler from './api/bot.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

let offset = 0;
let isRunning = true;

console.log('====================================================');
console.log('🤖 FlopRadar Telegram Bot Poller (@FlopRadarBot)');
console.log('Architect: Asad Lee (@asadleo416)');
console.log('Portfolio: https://asad-lee-portfolio.vercel.app/');
console.log('====================================================\n');

async function checkMe() {
  try {
    const res = await fetch(`${TELEGRAM_API}/getMe`);
    const data = await res.json();
    if (data.ok) {
      console.log(`✓ Bot Identity Verified: @${data.result.username} (${data.result.first_name})`);
      return true;
    } else {
      console.error('✗ Failed to verify bot token:', data.description);
      return false;
    }
  } catch (err) {
    console.warn('! Notice: Direct Telegram API check had network exception (may require proxy/VPN if in restricted network):', err.message);
    return false;
  }
}

async function pollUpdates() {
  while (isRunning) {
    try {
      const url = `${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
      const data = await res.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (msg && msg.text) {
            console.log(`[Message] From: ${msg.from?.username || msg.from?.id} | Text: ${msg.text.slice(0, 40)}`);
          }

          // Dispatch to bot handler
          const mockReq = {
            method: 'POST',
            body: update,
            headers: { host: 'localhost' }
          };

          const mockRes = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { return payload; },
            setHeader() {},
            end() {}
          };

          botHandler(mockReq, mockRes).catch(err => {
            console.error('Error handling update in poller:', err);
          });
        }
      } else if (!data.ok) {
        if (data.error_code === 409) {
          console.warn('[Conflict 409] Webhook is active on Telegram. Run with ?action=delete_webhook or disable webhook to use polling.');
          await new Promise(r => setTimeout(r, 5000));
        } else {
          console.warn('[Telegram API Warn]', data.description);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (err) {
      // Network timeout / connection error - brief pause before reconnect
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function start() {
  await checkMe();
  console.log('\n[FlopRadar Poller] Listening for incoming messages...');
  pollUpdates();
}

start();

process.on('SIGINT', () => {
  console.log('\nStopping bot poller...');
  isRunning = false;
  process.exit(0);
});
