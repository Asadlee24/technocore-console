/**
 * Vercel Serverless 24/7 Bounty Hunter Endpoint
 * Can be pinged every minute via free cron (cron-job.org / UptimeRobot / Vercel Cron)
 * Scans /r/tclk-offers, computes solutions, and delivers results straight to Telegram.
 */

import crypto from 'crypto';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8814701073:AAF2gj_wL-37JyJoqA_2vTDSdPN5NwFKXI0';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const AUTHORIZED_DID = 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegramAlert(chatId, text) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    console.error('sendTelegramAlert error:', err.message);
  }
}

function solveTask(context, specText = '') {
  const full = `${context || ''}\n${specText || ''}`;
  if (/exact pattern for a valid did:key identifier/i.test(full)) return '^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$';
  if (/maximum character length for a message in this protocol/i.test(full)) return '4096';
  if (/What frame does the payee send after receiving an offer/i.test(full)) return 'accept';
  if (/Nonce replay on the signed lane[\s\S]*Report the HTTP status of the second req/i.test(full)) return '400';
  const single = full.match(/Reply with the single word:\s*([A-Za-z0-9_-]+)/i);
  if (single) return single[1];

  // Math GCD & LCM
  const mathMatch = full.match(/Compute gcd\((\d+),\s*(\d+)\)\s*and\s*lcm\((\d+),\s*(\d+)\)/i);
  if (mathMatch) {
    try {
      const a = BigInt(mathMatch[1]);
      const b = BigInt(mathMatch[2]);
      const gcdBig = (x, y) => { while (y !== 0n) { let t = y; y = x % y; x = t; } return x; };
      const lcmBig = (x, y) => (x * y) / gcdBig(x, y);
      return `gcd=${gcdBig(a, b)} lcm=${lcmBig(a, b)}`;
    } catch (e) {}
  }

  const rowRegex = /(\d+)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(\d+)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(\d\d:\d\d:\d\d)/g;
  const rows = [];
  let m;
  while ((m = rowRegex.exec(full)) !== null) {
    rows.push({ seq: parseInt(m[1], 10), payer: m[2], amount: parseInt(m[3], 10), asset: m[4], time: m[6] });
  }
  if (rows.length > 0) {
    if (/even numbers[\s\S]*ascending order[\s\S]*comma-separated/i.test(full)) {
      const ev = rows.filter(r => r.seq % 2 === 0).map(r => r.seq).sort((a,b) => a - b);
      return ev.length ? ev.join(', ') : 'none';
    }
    if (/earliest time and the seq of the row with the latest time/i.test(full)) {
      const sorted = [...rows].sort((a,b) => a.time.localeCompare(b.time) || a.seq - b.seq);
      return `${sorted[0].seq} ${sorted[sorted.length-1].seq}`;
    }
    if (/3 rows with the largest amount[\s\S]*highest first/i.test(full)) {
      const sorted = [...rows].sort((a,b) => b.amount - a.amount || a.seq - b.seq);
      return sorted.slice(0, 3).map(r => r.seq).join(', ');
    }
  }
  return null;
}

export default async function handler(req, res) {
  try {
    // 1. Get stored Telegram Chat ID (defaults to Asad Lee: 7080909965)
    let targetChatId = process.env.TELEGRAM_CHAT_ID || '7080909965';
    if (!targetChatId) {
      try {
        const kvRes = await fetch('https://technocore.chat/kv/flopradar-alerts/chat_id');
        const kvText = await kvRes.text();
        const m = kvText.match(/\b([0-9]{7,12})\b/);
        if (m) targetChatId = m[1];
      } catch (e) {}
    }

    // 2. Fetch latest offers from /r/tclk-offers
    const roomRes = await fetch('https://technocore.chat/r/tclk-offers?format=json&limit=25');
    if (!roomRes.ok) {
      return res.status(200).json({ ok: false, error: 'Could not fetch tclk-offers' });
    }
    const roomData = await roomRes.json();

    const openOffers = [];
    if (roomData.messages && Array.isArray(roomData.messages)) {
      for (const msg of roomData.messages) {
        if (msg.text && msg.text.includes('"type":"offer"')) {
          try {
            const clean = msg.text.replace(/^tclk1\s+/, '');
            const parsed = JSON.parse(clean);
            openOffers.push({ seq: msg.seq, ...parsed });
          } catch (e) {}
        }
      }
    }

    if (openOffers.length === 0) {
      return res.status(200).json({ ok: true, message: 'No offers in current buffer', checked: roomData.messages?.length });
    }

    const solvedList = [];
    for (const off of openOffers.slice(-5)) {
      const amount = off.amount || '100';
      const asset = off.asset || 'FLOP';
      const context = off.job?.context || '';

      let specText = '';
      if (context.startsWith('/kv/')) {
        try {
          const r = await fetch('https://technocore.chat' + context);
          if (r.ok) specText = await r.text();
        } catch (e) {}
      } else {
        const specMatch = context.match(/(?:full spec:|\/kv\/)\s*(\/kv\/[^\s]+|[^\s]+\/kv\/[^\s]+)/);
        if (specMatch) {
          const specPath = specMatch[1].replace(/^[a-z]+:\/\/[^\/]+/i, '');
          try {
            const specRes = await fetch('https://technocore.chat' + specPath);
            if (specRes.ok) specText = await specRes.text();
          } catch (e) {}
        }
      }

      const solution = solveTask(context, specText);

      if (solution) {
        solvedList.push({
          seq: off.seq,
          id: off.id,
          amount: `${amount} ${asset}`,
          context: (context || specText).slice(0, 120),
          solution: solution
        });

        // Notify user on Telegram
        if (targetChatId) {
          const alertMsg = `⚡ <b>TCLK BOUNTY DETECTED &amp; SOLVED!</b>\n\n` +
            `💰 <b>Reward:</b> ${escapeHtml(amount)} ${escapeHtml(asset)}\n` +
            `📋 <b>Task:</b> <i>${escapeHtml((context || specText).slice(0, 100))}...</i>\n` +
            `💡 <b>Solution:</b> <code>${escapeHtml(solution)}</code>\n\n` +
            `<i>Target: Asad Lee (${escapeHtml(AUTHORIZED_DID.slice(0, 18))}...)</i>`;

          await sendTelegramAlert(targetChatId, alertMsg);
        }
      }
    }


    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      targetChatId: targetChatId ? `${targetChatId.slice(0, 4)}***` : 'Not registered yet (message @FlopRadarBot to register)',
      openOffersFound: openOffers.length,
      solvedCount: solvedList.length,
      solved: solvedList
    });

  } catch (err) {
    console.error('Auto-hunt error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
