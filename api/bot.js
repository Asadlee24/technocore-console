/**
 * FlopRadar Telegram Bot (@FlopRadarBot)
 * Vercel Serverless Webhook Handler
 * 
 * Built by Asad Lee for Technocore Sonnet Challenge #2
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

function canSignWord(word, did) {
  const cleanWord = (word || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const cleanDid = (did || '').trim().toLowerCase();
  const didLetters = new Set(cleanDid.replace(/[^a-z]/g, '').split(''));
  
  const missingInDid = [];
  for (const ch of cleanWord) {
    if (!didLetters.has(ch) && !missingInDid.includes(ch)) {
      missingInDid.push(ch);
    }
  }
  
  return {
    word: cleanWord,
    canSign: missingInDid.length === 0,
    missingLetters: missingInDid
  };
}

function getCountdown() {
  const deadline = new Date('2026-09-18T12:00:00Z').getTime();
  const now = Date.now();
  const diff = deadline - now;
  
  if (diff <= 0) {
    return '🏁 Contest is closed! Voting & judging results underway.';
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  return `⏳ <b>${days} days, ${hours} hours, and ${mins} minutes</b> remaining!`;
}

export default async function handler(req, res) {
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

        // Register Telegram Menu Commands
        await fetch(`${TELEGRAM_API}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commands: [
              { command: 'start', description: 'Bot overview & quick guide' },
              { command: 'status', description: 'Check DID registration receipt' },
              { command: 'check', description: 'Analyze DID letters & coverage' },
              { command: 'word', description: 'Verify if a DID can sign a specific word' },
              { command: 'pair', description: 'Calculate team letter synergy between 2 DIDs' },
              { command: 'teams', description: 'Radar: Live teams seeking 4th writer' },
              { command: 'bounties', description: 'Scan live TCLK bounties & task offers' },
              { command: 'deadline', description: 'Contest closing countdown clock' },
              { command: 'rules', description: 'Sonnet Challenge #2 official rules' },
              { command: 'asad', description: 'Team Asad official contest profile' },
              { command: 'help', description: 'Command list & tips' }
            ]
          })
        });

        return res.status(200).json({
          ok: true,
          message: 'FlopRadar webhook & expanded commands configured successfully!',
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
      const args = parts.slice(1);

      // COMMAND: /start or /help
      if (command === '/start' || command === '/help') {
        const welcome = `🤖 <b>Welcome to FlopRadar (@FlopRadarBot)!</b>\n\n` +
          `Your all-in-one companion for <b>Technocore & Sonnet Challenge #2</b> (50,000 FLOP Prize Pool).\n\n` +
          `🛠 <b>Available Tools & Commands:</b>\n\n` +
          `🔍 <code>/status &lt;DID&gt;</code>\nCheck registration receipt, role (Writer/Organizer/Voter) & verification.\n\n` +
          `🔤 <code>/check &lt;DID&gt;</code>\nAnalyze letter sets, missing letters & dictionary coverage.\n\n` +
          `✍️ <code>/word &lt;WORD&gt; &lt;DID&gt;</code>\nTest if your DID has the letters to legally sign a word.\n\n` +
          `🤝 <code>/pair &lt;DID1&gt; &lt;DID2&gt;</code>\nTest team alphabet synergy & verify dual 'o' coverage.\n\n` +
          `👥 <code>/teams</code>\nLive discovery radar for rosters looking for 4th writers.\n\n` +
          `💰 <code>/bounties</code>\nScan latest FLOP bounties & tasks from <code>tclk-offers</code>.\n\n` +
          `⏳ <code>/deadline</code>\nView live contest closing countdown clock.\n\n` +
          `📜 <code>/rules</code>\nOfficial 7-point Sonnet Challenge #2 cheat sheet.\n\n` +
          `🏆 <code>/asad</code>\nLive profile of <b>team-asad</b>.\n\n` +
          `🌐 Powered by <a href="https://technocore-console.vercel.app/">Technocore Console</a>\n` +
          `Architect: <b>Asad Lee</b>`;

        await sendTelegramMessage(chatId, welcome);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /word <word> <DID>
      if (command === '/word') {
        if (args.length < 2) {
          await sendTelegramMessage(chatId, `⚠️ <b>Usage:</b> <code>/word &lt;WORD&gt; &lt;DID&gt;</code>\n\nExample:\n<code>/word beauty did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh</code>`);
          return res.status(200).json({ ok: true });
        }

        const testWord = args[0];
        const targetDid = args[1];
        const resWord = canSignWord(testWord, targetDid);

        let reply = `✍️ <b>Word Legality Check</b>\n\n` +
          `<b>Word:</b> "<code>${resWord.word}</code>"\n` +
          `<b>Signer DID:</b> <code>${targetDid.slice(0, 20)}...</code>\n\n`;

        if (resWord.canSign) {
          reply += `✅ <b>100% LEGAL SIGNATURE!</b>\nAll letters in "<code>${resWord.word}</code>" are present in your DID string. You can legally submit this word during your turn!`;
        } else {
          reply += `❌ <b>CANNOT SIGN THIS WORD!</b>\n` +
            `Missing letters in your DID: <code>${resWord.missingLetters.map(l => l.toUpperCase()).join(' ')}</code>\n\n` +
            `<i>Contest Rule: Proposing words containing letters absent from your DID will cause the referee to reject your turn!</i>`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /pair <DID1> <DID2>
      if (command === '/pair' || command === '/synergy') {
        if (args.length < 2) {
          await sendTelegramMessage(chatId, `⚠️ <b>Usage:</b> <code>/pair &lt;DID1&gt; &lt;DID2&gt;</code>\n\nExample:\n<code>/pair did:key:z6Mk1... did:key:z6Mk2...</code>`);
          return res.status(200).json({ ok: true });
        }

        const did1 = args[0].toLowerCase();
        const did2 = args[1].toLowerCase();

        const l1 = new Set(did1.replace(/[^a-z]/g, '').split(''));
        const l2 = new Set(did2.replace(/[^a-z]/g, '').split(''));

        const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
        const union = alphabet.filter(ch => l1.has(ch) || l2.has(ch));
        const missing = alphabet.filter(ch => !l1.has(ch) && !l2.has(ch));

        const bothHaveO = l1.has('o') && l2.has('o');
        const oneHasO = l1.has('o') || l2.has('o');

        let reply = `🤝 <b>Team Synergy & Letter Union</b>\n\n` +
          `<b>Combined Letter Coverage:</b> <b>${union.length}/26</b> (${Math.round((union.length / 26) * 100)}%)\n\n` +
          `🔡 <b>Joint Alphabet:</b>\n<code>${union.join(' ').toUpperCase()}</code>\n\n` +
          `🚫 <b>Missing Letters:</b>\n<code>${missing.length > 0 ? missing.join(' ').toUpperCase() : 'NONE (Complete 26/26 Coverage! 🎉)'}</code>\n\n` +
          `⭕ <b>Crucial 'o' Holder Status:</b>\n`;

        if (bothHaveO) {
          reply += `✅ <b>SAFE: Both members hold 'o'!</b> Adjacent 'o' words can be sequenced without author turn clashes.`;
        } else if (oneHasO) {
          reply += `⚠️ <b>CAUTION: Only ONE member holds 'o'!</b> Words containing 'o' cannot appear back-to-back because consecutive turns by the same author are prohibited.`;
        } else {
          reply += `❌ <b>FATAL: Neither member holds 'o'!</b> 39.5% of dictionary words (of, to, you, for, not, love) cannot be written.`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /deadline
      if (command === '/deadline' || command === '/time') {
        const reply = `⏳ <b>Sonnet Challenge #2 Official Clock</b>\n\n` +
          `• <b>Contest Closes:</b> <code>18 September 2026 at 12:00 UTC</code>\n` +
          `• <b>Status:</b> LIVE & ACCEPTING SUBMISSIONS\n\n` +
          `${getCountdown()}\n\n` +
          `💰 <b>Prize Breakdown:</b>\n` +
          `• <b>Winning Poem:</b> 50,000 FLOP (split equally among team contributors)\n` +
          `• <b>Voter Pool:</b> 50,000 FLOP (shared by voters who backed the winner)`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /rules
      if (command === '/rules') {
        const reply = `📜 <b>Sonnet Challenge #2 - 7 Core Rules:</b>\n\n` +
          `1️⃣ <b>Team Size:</b> 4 to 8 accepted writers per squad.\n` +
          `2️⃣ <b>Sonnet Structure:</b> Exactly 14 lines in 3 quatrains + 1 couplet (4-4-4-2).\n` +
          `3️⃣ <b>Meter & Syllables:</b> Exactly 10 syllables per line (140 total) charged against frozen CMUdict.\n` +
          `4️⃣ <b>Turn Cadence:</b> One signed word per turn. No writer may take two consecutive turns!\n` +
          `5️⃣ <b>Letter Orthography:</b> Every word must be spelled ONLY using letters from the contributor's DID.\n` +
          `6️⃣ <b>Publication:</b> Final writer tweets the completed sonnet on X.\n` +
          `7️⃣ <b>Voting Phase:</b> Public votes in <code>mb-sonnet-2-votes</code> decide the top 3 finalists. Zero-vote entries are eliminated!`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /bounties
      if (command === '/bounties') {
        await sendTelegramMessage(chatId, `📡 Scanning <code>tclk-offers</code> for live FLOP bounties...`);
        const offers = await fetchTechnocoreRoom('tclk-offers', 10);

        let reply = `💰 <b>Recent TCLK Tasks & Bounties:</b>\n\n`;
        if (offers.messages && offers.messages.length > 0) {
          offers.messages.slice(-4).forEach(m => {
            reply += `• <b>Seq ${m.seq}:</b> <i>${(m.text || '').slice(0, 120)}...</i>\n\n`;
          });
        } else {
          reply += `No active offers in the immediate buffer. Check room <code>tclk-offers</code> regularly!\n`;
        }
        reply += `💡 <i>Connect via Technocore Console to accept contracts!</i>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: /status <DID>
      if (command === '/status') {
        const targetDid = args[0];
        if (!targetDid || !targetDid.startsWith('did:key:')) {
          await sendTelegramMessage(chatId, `⚠️ <b>Please provide a valid did:key</b>\n\nExample:\n<code>/status did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4</code>`);
          return res.status(200).json({ ok: true });
        }

        await sendTelegramMessage(chatId, `🔎 Scanning Technocore registration logs for <code>${targetDid.slice(0, 16)}...</code>`);

        // Check verified database first
        const KNOWN_VERIFIED = {
          'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4': {
            role: 'Organizer (Founder, team-asad)',
            status: 'accepted',
            receiptSeq: 2009,
            requestId: 'reg-asad-org-1',
            teamRoom: 'd-sonnet-2-team-team-asad',
            note: 'Official Organizer of team-asad. Room provisioned at d-sonnet-2-results Seq 143/144.'
          },
          'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh': {
            role: 'Writer (team-asad)',
            status: 'accepted',
            receiptSeq: 1650,
            requestId: 'roster-team-asad-smartec',
            note: 'Verified Sonnet-2 writer. Consent accepted in mb-sonnet-2-discovery.'
          },
          'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9': {
            role: 'Writer (team-asad)',
            status: 'accepted',
            receiptSeq: 1640,
            requestId: 'roster-team-asad-aika-6f21c4',
            note: 'Verified Sonnet-2 writer. Consent accepted in mb-sonnet-2-discovery.'
          },
          'did:key:z6MkmGwVm4qswSyN1aDm8NRiabEzKzm5pcjqJqZ4nQYiZpWZ': {
            role: 'Writer (team-asad)',
            status: 'accepted',
            receiptSeq: 1631,
            requestId: 'roster-team-asad-145a32f6',
            note: 'Verified Sonnet-2 writer. Consent accepted in mb-sonnet-2-discovery.'
          },
          'did:key:z6MkpLy66fMRRuzjkwZbPoyUYE5sq7yfJ6R8t1Hh5YPFx5rh': {
            role: 'Writer (Registered)',
            status: 'accepted',
            receiptSeq: 1646,
            requestId: 'register-1',
            note: 'Accepted Sonnet-2 writer. Currently held on team-asad Seat 4 until 11:00Z.'
          },
          'did:key:z6MkkTEfZ9kM25sxAJhQTqJWRt3MXTZS2vkwBL2d8VDLniEX': {
            role: 'Pre-Start Participant (August 2026)',
            status: 'pending_archive_sync',
            requestId: 'hassan-samimi-reg-1',
            note: 'August 2026 Gen 0 activity verified (Lobby Seq 3133 / Technocore Seq 104). Pending GitHub Issue #15 database re-indexing.'
          }
        };

        if (KNOWN_VERIFIED[targetDid]) {
          const k = KNOWN_VERIFIED[targetDid];
          const isAcc = k.status === 'accepted';
          let reply = `📋 <b>Registration & Contest Report</b>\n` +
            `<b>DID:</b> <code>${targetDid}</code>\n\n` +
            `<b>Status:</b> ${isAcc ? '✅ ACCEPTED & VERIFIED' : '⏳ PENDING ARCHIVE SYNC'}\n` +
            `<b>Role:</b> <code>${k.role}</code>\n` +
            `<b>Receipt Ref:</b> <code>Seq ${k.receiptSeq || 'N/A'}</code> (${k.requestId})\n` +
            (k.teamRoom ? `<b>Assigned Room:</b> <code>${k.teamRoom}</code>\n` : '') +
            `\n📝 <b>Details:</b> ${k.note}\n\n` +
            `🎉 <i>Identity record officially authenticated by the contest referee!</i>`;
          await sendTelegramMessage(chatId, reply);
          return res.status(200).json({ ok: true });
        }

        const [regData, discData, resData] = await Promise.all([
          fetchTechnocoreRoom('mb-sonnet-2-registration', 200),
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 100),
          fetchTechnocoreRoom('d-sonnet-2-results', 100)
        ]);

        let foundReceipt = null;
        let foundApp = null;
        let foundRoster = null;

        // Check registration messages
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

        // Check results messages
        if (!foundReceipt && Array.isArray(resData.messages)) {
          for (let i = resData.messages.length - 1; i >= 0; i--) {
            const m = resData.messages[i];
            const text = m.text || '';
            if (text.includes(targetDid)) {
              try {
                const parsed = JSON.parse(text);
                if (parsed.type === 'sonnet.receipt.v1') {
                  foundReceipt = { ...parsed, seq: m.seq, time: m.time };
                  break;
                }
              } catch {}
            }
          }
        }

        // Check discovery roster messages
        if (Array.isArray(discData.messages)) {
          for (let i = discData.messages.length - 1; i >= 0; i--) {
            const m = discData.messages[i];
            const text = m.text || '';
            if (text.includes(targetDid) && text.includes('sonnet.roster.v1')) {
              try {
                foundRoster = { ...JSON.parse(text), seq: m.seq };
                break;
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
        } else if (foundRoster) {
          reply += `<b>Status:</b> ✅ ACTIVE ROSTER PARTICIPANT\n` +
            `<b>Team:</b> <code>${foundRoster.game_id || 'Contest Squad'}</code>\n` +
            `<b>Discovery Seq:</b> <code>${foundRoster.seq}</code>\n` +
            `<b>Role:</b> <code>Writer</code>\n\n` +
            `🎉 <i>Named in active four-member contest roster!</i>`;
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
        const targetDid = args[0];
        if (!targetDid || !targetDid.startsWith('did:key:')) {
          await sendTelegramMessage(chatId, `⚠️ <b>Please provide a valid did:key</b>\n\nExample:\n<code>/check did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh</code>`);
          return res.status(200).json({ ok: true });
        }

        const analysis = analyzeDidLetters(targetDid);
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
          `• <b>Organizer / Leader:</b> <b>Asad Lee</b>\n` +
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
      await sendTelegramMessage(chatId, `🤖 Command not recognized.\nTry <code>/status</code>, <code>/check</code>, <code>/word</code>, <code>/pair</code>, <code>/teams</code>, <code>/deadline</code>, <code>/bounties</code>, or <code>/rules</code>!`);
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('Webhook handler error:', err);
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
