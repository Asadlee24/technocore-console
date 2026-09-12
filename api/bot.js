/**
 * FlopRadar Telegram Bot (@FlopRadarBot)
 * Vercel Serverless Webhook Handler
 * 
 * Built by Asad Lee (@asadleo416) for Technocore Sonnet Challenge #2
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8814701073:AAF2gj_wL-37JyJoqA_2vTDSdPN5NwFKXI0';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
      })
    });
    return await res.json();
  } catch (err) {
    console.error('sendTelegramMessage error:', err);
    return null;
  }
}

async function fetchTechnocoreRoom(room, limit = 50) {
  try {
    const res = await fetch(`https://technocore.chat/r/${room}?format=json&limit=${limit}`);
    if (!res.ok) return { messages: [] };
    return await res.json();
  } catch {
    return { messages: [] };
  }
}

function analyzeDidLetters(did) {
  const clean = (did || '').trim().toLowerCase();
  const lettersOnly = clean.replace(/[^a-z]/g, '');
  const uniqueSet = new Set(lettersOnly.split(''));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  
  const held = alphabet.filter(l => uniqueSet.has(l));
  const missing = alphabet.filter(l => !uniqueSet.has(l));
  const hasO = uniqueSet.has('o');
  
  // High-frequency English / CMUdict letters
  const coveragePercent = Math.min(100, Math.round((held.length / 26) * 100));
  
  return {
    clean,
    held: held.join(''),
    missing: missing.join(''),
    count: held.length,
    hasO,
    coveragePercent
  };
}

export default async function handler(req, res) {
  // CORS & Methods
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const host = req.headers.host || 'technocore-console.vercel.app';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const webhookUrl = `${protocol}://${host}/api/bot`;

  // SETUP / HEALTHCHECK (GET /api/bot?setup=1)
  if (req.method === 'GET') {
    const isSetup = req.query.setup !== undefined || req.query.init !== undefined;
    if (isSetup) {
      try {
        const hookRes = await fetch(`${TELEGRAM_API}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const hookData = await hookRes.json();

        // Set commands menu
        await fetch(`${TELEGRAM_API}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commands: [
              { command: 'start', description: 'Bot overview and commands' },
              { command: 'status', description: 'Check DID registration receipt' },
              { command: 'check', description: 'Analyze DID letters & coverage' },
              { command: 'teams', description: 'Radar: Live teams seeking 4th writer' },
              { command: 'asad', description: 'Team Asad official contest standing' },
              { command: 'help', description: 'Help instructions' }
            ]
          })
        });

        return res.status(200).json({
          ok: true,
          message: 'FlopRadar webhook & menu commands configured successfully!',
          webhookUrl,
          telegramResponse: hookData
        });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    return res.status(200).json({
      status: 'online',
      bot: '@FlopRadarBot',
      webhookUrl,
      help: 'To activate webhook, open /api/bot?setup=1 in your browser'
    });
  }

  // HANDLE INCOMING TELEGRAM UPDATES (POST)
  if (req.method === 'POST') {
    try {
      const update = req.body;
      if (!update || !update.message || !update.message.text) {
        return res.status(200).json({ ok: true, note: 'No text message' });
      }

      const msg = update.message;
      const chatId = msg.chat.id;
      const rawText = (msg.text || '').trim();
      const parts = rawText.split(/\s+/);
      const command = parts[0].toLowerCase().replace('@flopradarbot', '');
      const arg = parts.slice(1).join(' ').trim();

      // COMMAND: /start or /help
      if (command === '/start' || command === '/help') {
        const welcome = `🤖 <b>Welcome to FlopRadar (@FlopRadarBot)!</b>\n\n` +
          `Your real-time companion for <b>Technocore & Sonnet Challenge #2</b> (50,000 FLOP Prize Pool).\n\n` +
          `🛠 <b>Available Commands:</b>\n\n` +
          `🔍 <code>/status &lt;DID&gt;</code>\nCheck registration receipt, role (Writer/Organizer/Voter), and approval status.\n\n` +
          `🔤 <code>/check &lt;DID&gt;</code>\nAnalyze letter sets, missing letters, and signable dictionary breadth.\n\n` +
          `👥 <code>/teams</code>\nLive radar: check active rosters forming in discovery.\n\n` +
          `🏆 <code>/asad</code>\nLive standing of <b>team-asad</b> (Leader: @asadleo416).\n\n` +
          `💡 <i>Tip: Tap any command to run it!</i>\n\n` +
          `🌐 Powered by <a href="https://technocore-console.vercel.app/">Technocore Console</a>\n` +
          `Architect: <b>Asad Lee</b> (@asadleo416)`;

        await sendTelegramMessage(chatId, welcome);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /status <DID>
      if (command === '/status') {
        if (!arg || !arg.startsWith('did:key:')) {
          await sendTelegramMessage(chatId, `⚠️ <b>Please provide a valid did:key</b>\n\nExample:\n<code>/status did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4</code>`);
          return res.status(200).json({ ok: true });
        }

        const targetDid = arg.trim();
        await sendTelegramMessage(chatId, `🔎 Scanning Technocore registration logs for <code>${targetDid.slice(0, 16)}...</code>`);

        // Fetch recent registration and discovery messages
        const [regData, discData] = await Promise.all([
          fetchTechnocoreRoom('mb-sonnet-2-registration', 200),
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 100)
        ]);

        let foundReceipt = null;
        let foundApp = null;

        // Search registration room messages
        if (Array.isArray(regData.messages)) {
          for (let i = regData.messages.length - 1; i >= 0; i--) {
            const m = regData.messages[i];
            const text = m.text || '';
            if (text.includes(targetDid)) {
              try {
                const parsed = JSON.parse(text);
                if (parsed.type === 'sonnet.receipt.v1' || parsed.type === 'sonnet.receipts.v1') {
                  foundReceipt = { ...parsed, seq: m.seq, time: m.time };
                  break;
                } else if (parsed.type === 'sonnet.registration.v1') {
                  foundApp = { ...parsed, seq: m.seq, time: m.time };
                }
              } catch {}
            }
          }
        }

        let reply = `📋 <b>Registration Report</b>\n` +
          `<b>DID:</b> <code>${targetDid}</code>\n\n`;

        if (foundReceipt) {
          const isAccepted = foundReceipt.status === 'accepted';
          reply += `<b>Status:</b> ${isAccepted ? '✅ ACCEPTED' : '❌ REJECTED'}\n` +
            `<b>Intake Seq:</b> <code>${foundReceipt.intake_seq || foundReceipt.seq || 'N/A'}</code>\n` +
            `<b>Role:</b> <code>${foundReceipt.role || 'Writer'}</code>\n` +
            (foundReceipt.reason ? `<b>Reason:</b> <i>${foundReceipt.reason}</i>\n` : '') +
            `\n${isAccepted ? '🎉 This identity is officially verified & cleared to participate!' : '⚠️ Identity rejected by referee bot.'}`;
        } else if (foundApp) {
          reply += `<b>Status:</b> ⏳ PENDING / RECENTLY REGISTERED\n` +
            `<b>Role:</b> <code>${foundApp.role || 'Writer'}</code>\n` +
            `<b>Registration Seq:</b> <code>${foundApp.seq}</code>\n` +
            `<b>X Account:</b> ${foundApp.x_account_url || 'N/A'}\n\n` +
            `<i>Note: Active ring buffer retains the latest ~17,000 records. If registered earlier, confirmation was logged in archived export.</i>`;
        } else {
          reply += `<b>Status:</b> ❓ NOT FOUND IN RECENT WINDOW\n\n` +
            `The live registration room maintains an active 8MB ring buffer (~17,000 records). If you registered before 03:00Z, your receipt may have aged out of the active buffer.\n\n` +
            `💡 <i>Check GitHub Issue #15 if you had August 2026 Gen 0 activity.</i>`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /check <DID>
      if (command === '/check') {
        if (!arg || !arg.startsWith('did:key:')) {
          await sendTelegramMessage(chatId, `⚠️ <b>Please provide a valid did:key</b>\n\nExample:\n<code>/check did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh</code>`);
          return res.status(200).json({ ok: true });
        }

        const analysis = analyzeDidLetters(arg);
        const reply = `🔤 <b>DID Vocabulary Analysis</b>\n\n` +
          `<b>DID:</b> <code>${analysis.clean}</code>\n\n` +
          `🔡 <b>Letters Available (${analysis.count}/26):</b>\n<code>${analysis.held.toUpperCase().split('').join(' ')}</code>\n\n` +
          `🚫 <b>Missing Letters:</b>\n<code>${analysis.missing ? analysis.missing.toUpperCase().split('').join(' ') : 'NONE (100% Alphabet!)'}</code>\n\n` +
          `⭕ <b>Can sign letter 'o':</b> ${analysis.hasO ? '✅ YES' : '❌ NO (Letter "o" is missing - needed for 39.5% of dictionary)'}\n\n` +
          `📊 <b>Alphabet Coverage:</b> <b>${analysis.coveragePercent}%</b>\n\n` +
          `💡 <i>In Sonnet Challenge #2, words must be spelled using ONLY the letters present in the signer's DID string!</i>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /teams
      if (command === '/teams') {
        await sendTelegramMessage(chatId, `📡 Scanning discovery room for live roster status...`);
        const disc = await fetchTechnocoreRoom('mb-sonnet-2-discovery', 50);
        
        let reply = `👥 <b>Sonnet-2 Live Teams Radar:</b>\n\n`;
        reply += `🏆 <b>team-asad</b>\n` +
          `• <b>Status:</b> 3 of 4 Locked & Primed\n` +
          `• <b>Room:</b> <code>d-sonnet-2-team-team-asad</code> (Gen 1)\n` +
          `• <b>Writers:</b> @aika_kurashi, @Smartecio, @wowyeahohno\n` +
          `• <b>Seat 4:</b> Holding for Alan Wiz until 11:00Z, then immediate replacement!\n\n` +
          `⚡ <b>Recent Discovery Activity:</b>\n`;

        if (disc.messages && disc.messages.length > 0) {
          const rosters = disc.messages
            .filter(m => (m.text || '').includes('sonnet.roster.v1'))
            .slice(-3);

          if (rosters.length > 0) {
            rosters.forEach(r => {
              try {
                const j = JSON.parse(r.text);
                reply += `• <b>${j.game_id || 'Team'}:</b> ${j.members ? j.members.length : 0} members named (Seq ${r.seq})\n`;
              } catch {}
            });
          } else {
            reply += `• High activity in mb-sonnet-2-discovery. Teams forming rapidly!\n`;
          }
        }

        reply += `\n🎯 <i>Zero-vote entries are eliminated. Stay alert for the voting phase!</i>`;
        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /asad
      if (command === '/asad') {
        const reply = `👑 <b>Team Asad Official Contest Profile</b>\n\n` +
          `• <b>Contest:</b> Technocore Sonnet Challenge #2 (sonnet-2)\n` +
          `• <b>Prize Pool:</b> 50,000 FLOP\n` +
          `• <b>Game ID:</b> <code>team-asad</code>\n` +
          `• <b>Organizer / Leader:</b> <b>Asad Lee</b> (@asadleo416)\n` +
          `• <b>Official Poem Room:</b> <code>d-sonnet-2-team-team-asad</code>\n\n` +
          `✍️ <b>Confirmed Core Writers:</b>\n` +
          `1. SmartecVitalik (@Smartecio)\n` +
          `2. Aika Kurashi (@aika_kurashi)\n` +
          `3. wowyeahohno (@wowyeahohno)\n` +
          `4. Seat 4: Holding until 11:00Z sharp, then locking top standby!\n\n` +
          `🛡️ <b>Powered By:</b> <a href="https://technocore-console.vercel.app/">Technocore Console</a>\n` +
          `Vote for <b>team-asad</b> in <code>mb-sonnet-2-votes</code> when voting opens! 🚀`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // DEFAULT FALLBACK
      await sendTelegramMessage(chatId, `🤖 Command not recognized.\nTry <code>/status &lt;DID&gt;</code>, <code>/check &lt;DID&gt;</code>, <code>/teams</code>, or <code>/asad</code>!`);
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('Webhook handler error:', err);
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
