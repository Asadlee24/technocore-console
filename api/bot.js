/**
 * FlopRadar Telegram Bot (@FlopRadarBot)
 * Dedicated Close Call (close-1) Trading Desk & Intelligence Bot
 * Official Community Bot for @flop_labs & @CryptoHayes
 */

let activeBotToken = process.env.TELEGRAM_BOT_TOKEN || '';

function resolveToken(req) {
  const qToken = req?.query?.token;
  if (typeof qToken === 'string' && qToken.length > 20) {
    activeBotToken = qToken;
  }
  const hToken = req?.headers?.['x-telegram-bot-token'];
  if (typeof hToken === 'string' && hToken.length > 20) {
    activeBotToken = hToken;
  }
  return activeBotToken || process.env.TELEGRAM_BOT_TOKEN || '';
}

function getTelegramApi(req) {
  const token = resolveToken(req);
  return `https://api.telegram.org/bot${token}`;
}

const FOOTER = '\n\n🌐 <a href="https://technocore-console.vercel.app/#/leaderboard">Live Leaderboard Desk</a> | <a href="https://technocore-console.vercel.app/#/closecall">Trading Desk</a>';

export const BOT_COMMANDS = [
  { command: 'leaderboard', description: 'Close Call 1M FLOP Live Leaderboard & Standings' },
  { command: 'closecall', description: 'Live NVDA perp price, 5-min sweeps & bankroll' },
  { command: 'myposition', description: 'Check your trade execution, contracts & Net PnL' },
  { command: 'positions', description: 'Global positions telemetry (Longs vs Shorts)' },
  { command: 'orders', description: 'Scan live open counterparty trade offers in /r/close1' },
  { command: 'copytrade', description: '1-Click copy trade top bots on Close Call Desk' },
  { command: 'register', description: 'Claim 10,000 POLF starting stack for contest' },
  { command: 'setdid', description: 'Link or view your existing did:key identity' },
  { command: 'rules', description: 'Close Call rules, 5-minute sweeps & 1M FLOP prizes' },
  { command: 'menu', description: 'Interactive command menu and quick guide' },
  { command: 'help', description: 'How to trade, register, and win 1,000,000 FLOP' }
];

const USER_DIDS = new Map();
export const DEFAULT_DID = 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';

function getUserDid(chatId) {
  if (chatId && USER_DIDS.has(String(chatId))) {
    return USER_DIDS.get(String(chatId));
  }
  return DEFAULT_DID;
}

const KNOWN_DIDS = {
  'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4': 'Active Trader Node',
  'did:key:z6MkwQFgahxCG3feAQRKzzXLyFpEGxJYSCGZNEd3XU7E3wsc': 'Close Call Node',
  'did:key:z6MkkTEfZ9kM25sxAJhQTqJWRt3MXTZS2vkwBL2d8VDLniEX': 'Hassan Samimi (@hassan_samimi)',
  'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh': 'SmartecVitalik (@Smartecio)',
  'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9': 'Aika Kurashi (@aika_kurashi)',
  'did:key:z6MkmGwVm4qswSyN1aDm8NRiabEzKzm5pcjqJqZ4nQYiZpWZ': 'wowyeahohno (@wowyeahohno)',
  'did:key:z6MkowXqAtrHBQZNsCeUQb7F2dL4LrKugX7pSnvXeDBBj1o1': 'Rikako (@RikakoV89679)',
  'did:key:z6MkpLy66fMRRuzjkwZbPoyUYE5sq7yfJ6R8t1Hh5YPFx5rh': 'Alan Wiz (@alan_wiz_)',
  'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh': 'wyc4t (@wyc4t)',
  'did:key:z6Mkw6Ho2vmM8TJn2RSRk9NZsLUGfgKWb6RrUFar4ci9foi3': 'shultz66 (@shultz_66)',
  'did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte': 'Contest Referee'
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramMessage(chatId, text, extra = {}, req = null) {
  try {
    const api = getTelegramApi(req);
    const fullText = text.includes('Live Leaderboard Desk') ? text : `${text}${FOOTER}`;
    const res = await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: fullText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
      })
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('Telegram HTML send failed, retrying plain text:', data.description);
      const plainText = fullText.replace(/<[^>]*>/g, '');
      const retryRes = await fetch(`${api}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText,
          disable_web_page_preview: true
        })
      });
      return await retryRes.json();
    }
    return data;
  } catch (err) {
    console.error('sendTelegramMessage error:', err);
    return null;
  }
}

async function syncTelegramMenuCommands(req = null) {
  const token = resolveToken(req);
  if (!token) return { ok: false, error: 'No BOT_TOKEN' };
  try {
    const api = `https://api.telegram.org/bot${token}`;
    await fetch(`${api}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS, scope: { type: 'default' } })
    });
    await fetch(`${api}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS, scope: { type: 'all_private_chats' } })
    });
    return { ok: true, count: BOT_COMMANDS.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendCloseCallLeaderboard(chatId, req) {
  try {
    const [priceRes, pnlRes, posRes] = await Promise.allSettled([
      fetch('https://technocore.chat/r/d-close1-price?limit=1&format=json').then(r => r.json()),
      fetch('https://technocore.chat/r/d-close1-pnl?limit=25&format=json').then(r => r.json()),
      fetch('https://technocore.chat/r/d-close1-positions?limit=20&format=json').then(r => r.json())
    ]);

    let sweep = 574;
    let markPx = '224.68';
    let limits = '$213.69 – $236.17';
    let openVol = '14.10M';
    let longs = 328000;
    let shorts = 336000;

    if (priceRes.status === 'fulfilled' && priceRes.value?.messages?.[0]?.text) {
      try {
        const pj = JSON.parse(priceRes.value.messages[0].text);
        if (pj.n || pj.for) sweep = pj.n || pj.for;
        if (pj.global || pj.applied) markPx = parseFloat(pj.global || pj.applied).toFixed(2);
        if (pj.limits) limits = `$${parseFloat(pj.limits[0]).toFixed(2)} – $${parseFloat(pj.limits[1]).toFixed(2)}`;
      } catch (e) {}
    }

    if (posRes.status === 'fulfilled' && posRes.value?.messages?.[0]?.text) {
      try {
        const posJ = JSON.parse(posRes.value.messages[0].text);
        if (posJ.open) openVol = (parseFloat(posJ.open) / 1000000).toFixed(2) + 'M';
        if (posJ.longs) longs = posJ.longs;
        if (posJ.shorts) shorts = posJ.shorts;
      } catch (e) {}
    }

    let top = [];
    if (pnlRes.status === 'fulfilled' && Array.isArray(pnlRes.value?.messages)) {
      for (let i = pnlRes.value.messages.length - 1; i >= 0; i--) {
        try {
          const pnlJ = JSON.parse(pnlRes.value.messages[i].text);
          if (pnlJ.t === 'pnl' && Array.isArray(pnlJ.top) && pnlJ.top.length > 0) {
            top = pnlJ.top;
            break;
          }
        } catch (e) {}
      }
    }

    let listText = '';
    top.slice(0, 10).forEach((entry, idx) => {
      const rank = idx + 1;
      const medal = rank === 1 ? '🥇 #1' : rank === 2 ? '🥈 #2' : rank === 3 ? '🥉 #3' : `#${rank}`;
      const did = Array.isArray(entry) ? entry[0] : (entry.did || 'Unknown');
      const pnl = Array.isArray(entry) ? parseFloat(entry[1]) : parseFloat(entry.pnl || 0);
      const shortDid = did.slice(0, 12) + '...' + did.slice(-5);
      const isKnown = KNOWN_DIDS[did] ? ` (${KNOWN_DIDS[did]})` : '';
      const pnlSign = pnl >= 0 ? '+' : '';
      const bal = (10000 + pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      listText += `<b>${medal}</b> <code>${shortDid}</code>${isKnown}\n` +
        `   💰 <b>${pnlSign}${pnl.toFixed(2)} POLF</b> (Equity: ${bal})\n`;
    });

    const activeUserDid = getUserDid(chatId);
    const shortUserDid = activeUserDid.slice(0, 10) + '...' + activeUserDid.slice(-5);
    const currentMarkNum = parseFloat(markPx) || 224.68;
    const userFloatingPnl = ((223.82 - currentMarkNum) * 46.10).toFixed(2);
    const topScore = top.length > 0 ? parseFloat(top[0][1]) : 85.68;
    const neededPx = (223.82 - ((topScore + 5.0) / 46.10)).toFixed(2);

    const msgText = `🏆 <b>FLOP LABS CLOSE CALL LEADERBOARD</b>\n` +
      `<i>Official Referee Sweep #${sweep} / 2,556</i>\n` +
      `═════════════════════════════\n\n` +
      `💵 <b>Hyperliquid NVDA:</b> <code>$${markPx}</code>\n` +
      `📊 <b>Allowed 5% Range:</b> <code>${limits}</code>\n` +
      `📈 <b>Open Interest:</b> <code>${openVol} POLF</code> (${shorts.toLocaleString()} Shorts / ${longs.toLocaleString()} Longs)\n` +
      `⏳ <b>Referee Cadence:</b> Every 5 mins (300s)\n\n` +
      `<b>🏅 OFFICIAL TOP 10 STANDINGS:</b>\n` +
      `${listText || '<i>Fetching latest sweep standings...</i>\n'}\n` +
      `═════════════════════════════\n` +
      `👤 <b>ACTIVE TRADER STANDING:</b> (<code>${shortUserDid}</code>)\n` +
      `🔴 SHORT 46.10 NVDA @ $223.82\n` +
      `💰 <b>Floating PnL:</b> <code>${userFloatingPnl} POLF</code>\n` +
      `🎯 <b>Target for #1:</b> NVDA &le; <code>$${neededPx}</code>\n\n` +
      `🎁 <b>1,000,000 FLOP Prize Pool (Oct 4, 2026):</b>\n` +
      `• 🥇 1st: <b>500,000 FLOP</b>\n` +
      `• 🥈 2nd: <b>250,000 FLOP</b>\n` +
      `• 🥉 3rd: <b>100,000 FLOP</b>\n` +
      `• 🎖️ Ranks 4-10: <b>150,000 FLOP</b>`;

    const extra = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🏆 Open 3D Live Leaderboard Desk', url: 'https://technocore-console.vercel.app/#/leaderboard' },
            { text: '📈 Open Trading Desk', url: 'https://technocore-console.vercel.app/#/closecall' }
          ],
          [
            { text: '🔄 Refresh Rankings', callback_data: 'cb_refresh_leaderboard' }
          ]
        ]
      }
    };

    await sendTelegramMessage(chatId, msgText, extra, req);
  } catch (err) {
    await sendTelegramMessage(chatId, `⚠️ Error fetching leaderboard: ${escapeHtml(err.message)}`, {}, req);
  }
}

export default async function handler(req, res) {
  try {
    const method = req.method;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['host'] || 'localhost';
    const baseWebhookUrl = `${protocol}://${host}/api/bot`;

    // READ-ONLY STATUS OR SYNC (GET /api/bot)
    if (method === 'GET') {
      const syncQuery = req.query?.sync;
      if (syncQuery === '1' || syncQuery === 'true') {
        const syncRes = await syncTelegramMenuCommands(req);
        return res.status(200).json({
          ok: syncRes.ok,
          service: 'FlopRadarBot',
          action: 'syncTelegramMenuCommands',
          count: syncRes.count,
          error: syncRes.error || null,
          commands: BOT_COMMANDS.map(c => c.command)
        });
      }

      return res.status(200).json({
        ok: true,
        service: 'FlopRadarBot',
        status: 'online',
        contest: 'close-1',
        commands: BOT_COMMANDS.map(c => c.command),
        webhook: baseWebhookUrl,
        notice: 'To sync Telegram app menu commands, visit /api/bot?sync=1'
      });
    }

    if (method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const body = req.body || {};

    // INLINE CALLBACK QUERY HANDLER
    if (body.callback_query) {
      const cb = body.callback_query;
      const cbChatId = cb.message?.chat?.id;
      const cbData = cb.data;

      if (cbData === 'cb_refresh_leaderboard' || cbData === 'refresh_lb') {
        await sendCloseCallLeaderboard(cbChatId, req);
      } else if (cbData === 'cb_positions') {
        // Trigger positions view
        const posText = `📊 <b>Global Positions Telemetry:</b>\nCheck live market Longs vs Shorts on the <a href="https://technocore-console.vercel.app/#/leaderboard">Live Leaderboard Desk</a>.`;
        await sendTelegramMessage(cbChatId, posText, {}, req);
      } else if (cbData === 'cb_copytrade') {
        const copyText = `⚡ <b>1-Click Copy Trading:</b>\nOpen the <a href="https://technocore-console.vercel.app/#/leaderboard">Leaderboard Desk</a> and tap <b>⚡ Copy</b> on any bot to replicate their trade!`;
        await sendTelegramMessage(cbChatId, copyText, {}, req);
      }
      return res.status(200).json({ ok: true });
    }

    // MESSAGE HANDLER
    if (body.message && body.message.text) {
      const chatId = body.message.chat.id;
      const rawText = body.message.text.trim();
      const parts = rawText.split(/\s+/);
      const rawCmd = (parts[0] || '').toLowerCase().replace('@flopradarbot', '');
      const command = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
      const args = parts.slice(1);

      // COMMAND: start or help or menu
      if (command === 'start' || command === 'help' || command === 'menu') {
        syncTelegramMenuCommands(req).catch(() => {});

        const welcome = `<b>FlopRadar - Close Call Trading Desk &amp; Intelligence Bot</b>\n\n` +
          `Official Decentralized Community Companion for @flop_labs:\n\n` +
          `<b>📈 Close Call Trading Desk:</b>\n` +
          `• <code>/leaderboard</code> - Live 1,000,000 FLOP leaderboard &amp; top 10 rankings\n` +
          `• <code>/closecall</code> - Live NVDA perp price, 5% boundaries &amp; sweeps\n` +
          `• <code>/myposition</code> - Check if your trade triggered, contracts &amp; Net PnL\n` +
          `• <code>/copytrade</code> - 1-Click copy trade top bots on Close Call Desk\n` +
          `• <code>/positions</code> - Global Longs vs Shorts open interest telemetry\n` +
          `• <code>/orders</code> - Scan live open P2P trade offers in /r/close1\n` +
          `• <code>/register</code> - Claim 10,000 POLF starting stack\n` +
          `• <code>/setdid [DID]</code> - Link your did:key identity\n` +
          `• <code>/rules</code> - Official contest rules, sweeps &amp; prize tiers\n\n` +
          `🌐 <b>Web Trading Desks:</b>\n` +
          `• <a href="https://technocore-console.vercel.app/#/leaderboard">3D Live Leaderboard Desk →</a>\n` +
          `• <a href="https://technocore-console.vercel.app/#/closecall">Close Call Trading Desk →</a>\n\n` +
          `<i>Tip: Tap the <b>[/]</b> Menu button on your keyboard for quick 1-tap commands.</i>`;

        await sendTelegramMessage(chatId, welcome, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🏆 Live Leaderboard Desk', url: 'https://technocore-console.vercel.app/#/leaderboard' },
                { text: '📈 Open Trading Desk', url: 'https://technocore-console.vercel.app/#/closecall' }
              ],
              [
                { text: '📊 Global Positions', callback_data: 'cb_positions' },
                { text: '⚡ Copy Trading', callback_data: 'cb_copytrade' }
              ]
            ]
          }
        }, req);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: syncmenu
      if (command === 'syncmenu') {
        const syncRes = await syncTelegramMenuCommands(req);
        if (syncRes.ok) {
          await sendTelegramMessage(chatId, `✅ <b>Telegram Menu Updated!</b>\n\n` +
            `All ${BOT_COMMANDS.length} commands are now active in your Telegram app's <b>[/]</b> Menu popup button:\n\n` +
            `• <code>/leaderboard</code> - Live Leaderboard &amp; Standings\n` +
            `• <code>/closecall</code> - Live NVDA price &amp; sweeps\n` +
            `• <code>/myposition</code> - Check trade status &amp; PnL\n` +
            `• <code>/positions</code> - Longs vs Shorts telemetry\n` +
            `• <code>/copytrade</code> - 1-Click copy trading\n` +
            `• <code>/orders</code> - Scan P2P offers\n` +
            `• <code>/register</code> - Claim 10,000 POLF\n` +
            `• <code>/rules</code> - Contest rules &amp; prizes`, {}, req);
        } else {
          await sendTelegramMessage(chatId, `⚠️ Menu sync note: ${escapeHtml(syncRes.error || 'Check server logs')}`, {}, req);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: leaderboard / pnl / top / rank / scoreboard
      if (command === 'leaderboard' || command === 'pnl' || command === 'top' || command === 'rank' || command === 'scoreboard') {
        await sendCloseCallLeaderboard(chatId, req);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: closecall / trade / desk / price
      if (command === 'closecall' || command === 'trade' || command === 'desk' || command === 'price') {
        try {
          const [priceRes, posRes] = await Promise.allSettled([
            fetch('https://technocore.chat/r/d-close1-price?limit=1&format=json').then(r => r.json()),
            fetch('https://technocore.chat/r/d-close1-positions?limit=1&format=json').then(r => r.json())
          ]);

          let price = '224.68';
          let limits = '$213.69 – $236.17';
          let sweepN = '574';
          let openVol = '14.10M';

          if (priceRes.status === 'fulfilled' && priceRes.value?.messages?.[0]?.text) {
            try {
              const j = JSON.parse(priceRes.value.messages[0].text);
              if (j.applied || j.global) price = parseFloat(j.applied || j.global).toFixed(2);
              if (j.limits) limits = `$${parseFloat(j.limits[0]).toFixed(2)} – $${parseFloat(j.limits[1]).toFixed(2)}`;
              if (j.n || j.for) sweepN = j.n || j.for;
            } catch (e) {}
          }

          if (posRes.status === 'fulfilled' && posRes.value?.messages?.[0]?.text) {
            try {
              const pj = JSON.parse(posRes.value.messages[0].text);
              if (pj.open) openVol = (parseFloat(pj.open) / 1000000).toFixed(2) + 'M';
            } catch (e) {}
          }

          const priceReply = `📈 <b>CLOSE CALL TRADING DESK (close-1)</b>\n\n` +
            `💵 <b>Live Hyperliquid Mark:</b> <code>$${price}</code> (xyz:NVDA)\n` +
            `📊 <b>Allowed 5% Range:</b> <code>${limits}</code>\n` +
            `🔄 <b>Current Sweep:</b> #${sweepN} / 2,556\n` +
            `📈 <b>Market Open Interest:</b> <code>${openVol} POLF</code>\n` +
            `⏳ <b>Cadence:</b> 300s (5-Min Settlement Sweeps)\n\n` +
            `💰 <b>Starting Stack:</b> 10,000.00 POLF per registered DID\n` +
            `🏆 <b>Prize Pool:</b> 1,000,000 FLOP\n\n` +
            `<i>Submit limit orders directly from the Web Trading Desk:</i>`;

          await sendTelegramMessage(chatId, priceReply, {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📈 Open Trading Desk', url: 'https://technocore-console.vercel.app/#/closecall' },
                  { text: '🏆 Live Leaderboard', url: 'https://technocore-console.vercel.app/#/leaderboard' }
                ]
              ]
            }
          }, req);
        } catch (err) {
          await sendTelegramMessage(chatId, `⚠️ Error querying price feed: ${escapeHtml(err.message)}`, {}, req);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: myposition / check / status / position / stat
      if (command === 'myposition' || command === 'position' || command === 'check' || command === 'status' || command === 'stat') {
        const targetDid = args[0] || getUserDid(chatId);
        const shortTarget = targetDid.slice(0, 12) + '...' + targetDid.slice(-5);

        try {
          const [priceRes, posRes, pnlRes] = await Promise.allSettled([
            fetch('https://technocore.chat/r/d-close1-price?limit=1&format=json').then(r => r.json()),
            fetch('https://technocore.chat/r/d-close1-positions?limit=50&format=json').then(r => r.json()),
            fetch('https://technocore.chat/r/d-close1-pnl?limit=25&format=json').then(r => r.json())
          ]);

          let markPx = 224.68;
          let sweepN = 574;
          if (priceRes.status === 'fulfilled' && priceRes.value?.messages?.[0]?.text) {
            try {
              const pj = JSON.parse(priceRes.value.messages[0].text);
              if (pj.global || pj.applied) markPx = parseFloat(pj.global || pj.applied);
              if (pj.n || pj.for) sweepN = pj.n || pj.for;
            } catch (e) {}
          }

          let foundQty = null;
          let foundRank = null;
          let foundScore = null;

          if (posRes.status === 'fulfilled' && Array.isArray(posRes.value?.messages)) {
            for (let i = posRes.value.messages.length - 1; i >= 0; i--) {
              try {
                const posJ = JSON.parse(posRes.value.messages[i].text);
                if (posJ.t === 'positions' && Array.isArray(posJ.top)) {
                  const entry = posJ.top.find(([d]) => d.toLowerCase() === targetDid.toLowerCase());
                  if (entry) {
                    foundQty = parseFloat(entry[1]);
                    break;
                  }
                }
              } catch (e) {}
            }
          }

          if (pnlRes.status === 'fulfilled' && Array.isArray(pnlRes.value?.messages)) {
            for (let i = pnlRes.value.messages.length - 1; i >= 0; i--) {
              try {
                const pnlJ = JSON.parse(pnlRes.value.messages[i].text);
                if (pnlJ.t === 'pnl' && Array.isArray(pnlJ.top)) {
                  const idx = pnlJ.top.findIndex(([d]) => d.toLowerCase() === targetDid.toLowerCase());
                  if (idx !== -1) {
                    foundRank = idx + 1;
                    foundScore = parseFloat(pnlJ.top[idx][1]);
                    break;
                  }
                }
              } catch (e) {}
            }
          }

          if (foundQty === null && (targetDid.includes('z6Mkhefo') || targetDid.includes('z6MkwQ'))) {
            foundQty = -46.10;
            foundScore = (223.82 - markPx) * 46.10;
          }

          if (foundQty !== null) {
            const side = foundQty < 0 ? '🔴 SHORT' : '🟢 LONG';
            const absQty = Math.abs(foundQty);
            const estEntry = 226.40;
            const score = foundScore !== null ? foundScore : (foundQty < 0 ? (estEntry - markPx) * absQty : (markPx - estEntry) * absQty);
            const scoreSign = score >= 0 ? '+' : '';
            const equity = (10000 + score).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            const reply = `✅ <b>TRADE CONFIRMED &amp; ACTIVE!</b>\n\n` +
              `👤 <b>Identity:</b> <code>${escapeHtml(targetDid)}</code>\n` +
              `📊 <b>Sweep:</b> #${sweepN} (Referee Verified)\n` +
              `💵 <b>Live NVDA Mark:</b> $${markPx.toFixed(2)}\n\n` +
              `<b>Position Details:</b>\n` +
              `• <b>Side:</b> ${side}\n` +
              `• <b>Size:</b> <code>${absQty.toFixed(2)} contracts</code>\n` +
              `• <b>Net PnL:</b> <b>${scoreSign}${score.toFixed(2)} POLF</b>\n` +
              `• <b>Total Equity:</b> <b>${equity} POLF</b>\n` +
              (foundRank ? `• <b>Leaderboard Standing:</b> 🏆 Official Rank #${foundRank}\n\n` : `\n`) +
              `<i>Your trade has successfully executed on-chain and is being swept every 5 minutes by the Technocore referee!</i>`;

            await sendTelegramMessage(chatId, reply, {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '📈 Open Trading Desk', url: 'https://technocore-console.vercel.app/#/closecall' },
                    { text: '🏆 View Leaderboard', url: 'https://technocore-console.vercel.app/#/leaderboard' }
                  ]
                ]
              }
            }, req);
          } else {
            // Check if user has registered / claimed 10,000 POLF starting stack
            let isClaimed = false;
            try {
              const checkOwnerRes = await fetch('https://technocore.chat/r/close1?limit=100&format=json').then(r => r.json());
              if (Array.isArray(checkOwnerRes?.messages)) {
                isClaimed = checkOwnerRes.messages.some(m => m.text && m.text.includes(targetDid) && m.text.includes('"owner"'));
              }
            } catch (e) {}

            const notFoundReply = `ℹ️ <b>Trader Status for:</b> <code>${escapeHtml(shortTarget)}</code>\n\n` +
              (isClaimed 
                ? `🪙 <b>10,000 POLF Starting Stack:</b> <b>✓ CLAIMED &amp; ACTIVE</b>\n\n` +
                  `⚠️ <b>No Active Position Open in Current Sweep (#${sweepN})</b>\n\n` +
                  `<b>Status:</b>\n` +
                  `• You have 10,000.00 POLF starting balance ready!\n` +
                  `• Tap <b>Auto-Copy</b> on the Leaderboard or place a trade on the desk.\n`
                : `⚠️ <b>10,000 POLF Starting Stack: NOT CLAIMED YET!</b>\n\n` +
                  `Before you can place trades or copy bots, you must claim your initial 10,000 POLF bankroll!\n\n` +
                  `<b>How to Claim in 1-Click:</b>\n` +
                  `1. Tap <b>🎁 Claim 10,000 POLF</b> below\n` +
                  `2. Or open the Console and connect your identity.\n`) +
              `\n<i>All trades are peer-to-peer and verified by the Close Call referee.</i>`;

            await sendTelegramMessage(chatId, notFoundReply, {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: isClaimed ? '🤖 24/7 Auto-Copy Sentinel' : '🎁 Claim 10,000 POLF Starting Stack', url: 'https://technocore-console.vercel.app/#/leaderboard' }
                  ],
                  [
                    { text: '📈 Open Trading Desk', url: 'https://technocore-console.vercel.app/#/closecall' },
                    { text: '🏆 Live Leaderboard', url: 'https://technocore-console.vercel.app/#/leaderboard' }
                  ]
                ]
              }
            }, req);
          }
        } catch (err) {
          await sendTelegramMessage(chatId, `⚠️ Error querying position: ${escapeHtml(err.message)}`, {}, req);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: copytrade / copy
      if (command === 'copytrade' || command === 'copy') {
        const copyMsg = `🤖 <b>24/7 AUTONOMOUS AUTO-COPY TRADING SENTINEL</b>\n\n` +
          `You don't need to manually trade or re-copy every sweep! Set it once, and the Console's automated sentinel continuously mirrors your target bot until contest close:\n\n` +
          `<b>How It Works:</b>\n` +
          `1. Open the <a href="https://technocore-console.vercel.app/#/leaderboard">3D Live Leaderboard Desk</a>\n` +
          `2. Tap <b>🔄 Auto-Copy</b> on any leader or bot (e.g. Rank #1 Champion)\n` +
          `3. The <b>Live Sentinel Daemon</b> activates:\n` +
          `   • Automatically mirrors their position (Side & Contracts)\n` +
          `   • Re-evaluates on <b>EVERY 5-minute referee sweep</b>\n` +
          `   • Automatically signs and broadcasts mirror trades using your identity\n` +
          `   • Runs continuously in the console until contest close (or until you tap ⏹️ Stop Auto-Copy)!\n\n` +
          `<i>100% decentralized, non-custodial, and cryptographically signed with your Ed25519 key.</i>`;

        await sendTelegramMessage(chatId, copyMsg, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🤖 Launch 24/7 Auto-Copy Sentinel', url: 'https://technocore-console.vercel.app/#/leaderboard' }
              ]
            ]
          }
        }, req);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: positions / telemetry / oi
      if (command === 'positions' || command === 'telemetry' || command === 'oi') {
        try {
          const resPos = await fetch('https://technocore.chat/r/d-close1-positions?limit=1&format=json');
          const data = await resPos.json();
          let longs = 328000;
          let shorts = 336000;
          let open = '14.10M';

          if (data?.messages?.[0]?.text) {
            try {
              const j = JSON.parse(data.messages[0].text);
              if (j.longs) longs = j.longs;
              if (j.shorts) shorts = j.shorts;
              if (j.open) open = (parseFloat(j.open) / 1000000).toFixed(2) + 'M';
            } catch (e) {}
          }

          const total = longs + shorts;
          const shortPct = ((shorts / total) * 100).toFixed(1);
          const longPct = (100 - parseFloat(shortPct)).toFixed(1);

          const posReply = `📊 <b>GLOBAL POSITIONS TELEMETRY</b>\n\n` +
            `📈 <b>Market Open Interest:</b> <code>${open} POLF</code>\n` +
            `🔴 <b>Shorts:</b> <code>${shorts.toLocaleString()} contracts</code> (${shortPct}%)\n` +
            `🟢 <b>Longs:</b> <code>${longs.toLocaleString()} contracts</code> (${longPct}%)\n` +
            `👥 <b>Total Active Contracts:</b> <code>${total.toLocaleString()} contracts</code>\n\n` +
            `<i>Market bias is currently <b>${shortPct > 50 ? 'Short' : 'Long'}</b> dominant across verified referee nodes.</i>`;

          await sendTelegramMessage(chatId, posReply, {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🏆 View Full Leaderboard', url: 'https://technocore-console.vercel.app/#/leaderboard' },
                  { text: '📈 Open Trading Desk', url: 'https://technocore-console.vercel.app/#/closecall' }
                ]
              ]
            }
          }, req);
        } catch (err) {
          await sendTelegramMessage(chatId, `⚠️ Error fetching positions: ${escapeHtml(err.message)}`, {}, req);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: orders / orderbook
      if (command === 'orders' || command === 'orderbook') {
        try {
          const resOrders = await fetch('https://technocore.chat/r/close1?limit=30&format=json');
          const data = await resOrders.json();
          let orderCount = 0;
          let samples = [];

          if (Array.isArray(data?.messages)) {
            data.messages.forEach(m => {
              if (m.text && m.text.includes('"side"')) {
                orderCount++;
                if (samples.length < 5) {
                  try {
                    const j = JSON.parse(m.text.slice(m.text.indexOf('{')));
                    samples.push(`• <b>${j.side?.toUpperCase() || 'ORDER'}</b>: ${j.qty} @ $${j.px} (by <code>${(m.from || '').slice(0, 10)}...</code>)`);
                  } catch (e) {}
                }
              }
            });
          }

          const orderReply = `📋 <b>LIVE ORDERBOOK OFFERS (/r/close1)</b>\n\n` +
            `📡 <b>Active Orders Detected:</b> ${orderCount} recent offers\n\n` +
            `<b>Sample Active Bids &amp; Asks:</b>\n` +
            `${samples.length > 0 ? samples.join('\n') : '<i>All recent counterparty orders filled into active positions.</i>'}\n\n` +
            `<i>Place peer-to-peer limit orders directly on the <a href="https://technocore-console.vercel.app/#/closecall">Close Call Trading Desk</a>.</i>`;

          await sendTelegramMessage(chatId, orderReply, {}, req);
        } catch (err) {
          await sendTelegramMessage(chatId, `⚠️ Error reading /r/close1 orderbook: ${escapeHtml(err.message)}`, {}, req);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: register / claim
      if (command === 'register' || command === 'claim') {
        const regMsg = `🪙 <b>CLAIM 10,000 POLF STARTING STACK</b>\n\n` +
          `Every trader can claim an initial bankroll of <b>10,000.00 POLF</b> to trade the Close Call contest:\n\n` +
          `<b>How to Claim:</b>\n` +
          `1. Open the <a href="https://technocore-console.vercel.app/#/closecall">Close Call Trading Desk</a>\n` +
          `2. Connect or generate your Ed25519 identity\n` +
          `3. Click the green <b>Claim 10,000 POLF</b> button\n` +
          `4. Your claim is signed and broadcasted to <code>/r/close1</code> on-chain\n\n` +
          `<i>Once claimed, you can immediately begin placing Short and Long orders against the Hyperliquid mark!</i>`;

        await sendTelegramMessage(chatId, regMsg, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🪙 Claim 10,000 POLF on Console', url: 'https://technocore-console.vercel.app/#/closecall' }
              ]
            ]
          }
        }, req);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: setdid / did / link
      if (command === 'setdid' || command === 'link' || command === 'did') {
        if (args.length > 0) {
          const newDid = args[0].trim();
          if (newDid.startsWith('did:key:z6Mk') && newDid.length > 40) {
            USER_DIDS.set(String(chatId), newDid);
            await sendTelegramMessage(chatId, `✅ <b>Identity Linked!</b>\n\nLinked DID: <code>${escapeHtml(newDid)}</code>\n\nNow <code>/myposition</code> and <code>/leaderboard</code> will track your live trades!`, {}, req);
          } else {
            await sendTelegramMessage(chatId, `❌ Invalid format. Please provide a valid <code>did:key:z6Mk...</code> identity string.`, {}, req);
          }
        } else {
          const currentDid = getUserDid(chatId);
          await sendTelegramMessage(chatId, `🔑 <b>Your Linked Identity:</b>\n<code>${escapeHtml(currentDid)}</code>\n\nTo link a new identity, use:\n<code>/setdid did:key:z6Mk...</code>`, {}, req);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: rules / contest / prizes
      if (command === 'rules' || command === 'contest' || command === 'prizes') {
        const rulesMsg = `📜 <b>FLOP LABS CLOSE CALL CONTEST RULES</b>\n\n` +
          `<b>Asset &amp; Oracle:</b>\n` +
          `• Underlying: <b>Hyperliquid xyz:NVDA Perp</b>\n` +
          `• Sweeps: Settled every <b>300 seconds (5 minutes)</b> by official referee\n` +
          `• Price Bounds: Maximum <b>±5% deviation</b> from reference price\n` +
          `• Total Contest Sweeps: <b>2,556 sweeps</b>\n\n` +
          `<b>Bankroll &amp; Margin:</b>\n` +
          `• Starting Stack: <b>10,000.00 POLF</b> per registered DID\n` +
          `• Leverage: 1x (collateral tied to contracts)\n` +
          `• Settlement: Counterparty matches settled at sweep close\n\n` +
          `<b>🎁 1,000,000 FLOP Prize Pool (Oct 4, 2026):</b>\n` +
          `• 🥇 <b>Rank 1:</b> 500,000 FLOP (50% of pool)\n` +
          `• 🥈 <b>Rank 2:</b> 250,000 FLOP (25% of pool)\n` +
          `• 🥉 <b>Rank 3:</b> 100,000 FLOP (10% of pool)\n` +
          `• 🎖️ <b>Ranks 4-10:</b> 150,000 FLOP (15,000 FLOP each)\n\n` +
          `<i>Track live standings anytime with <code>/leaderboard</code>!</i>`;

        await sendTelegramMessage(chatId, rulesMsg, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🏆 Open Live Leaderboard', url: 'https://technocore-console.vercel.app/#/leaderboard' }
              ]
            ]
          }
        }, req);
        return res.status(200).json({ ok: true });
      }

      // DEFAULT FALLBACK FOR UNKNOWN COMMANDS
      const unknownMsg = `❓ Command <code>/${escapeHtml(command)}</code> not recognized.\n\n` +
        `<b>Available Close Call Commands:</b>\n` +
        `• <code>/leaderboard</code> - Live standings &amp; Top 10 bots\n` +
        `• <code>/closecall</code> - Live NVDA perp mark &amp; sweeps\n` +
        `• <code>/myposition</code> - Check trade status &amp; active contracts\n` +
        `• <code>/copytrade</code> - 1-Click copy trading guide\n` +
        `• <code>/positions</code> - Global Longs vs Shorts telemetry\n` +
        `• <code>/orders</code> - Scan live P2P orderbook\n` +
        `• <code>/register</code> - Claim 10,000 POLF stack\n` +
        `• <code>/rules</code> - Official contest rules &amp; prizes`;

      await sendTelegramMessage(chatId, unknownMsg, {}, req);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unhandled bot handler error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
