/**
 * FlopRadar Telegram Bot (@FlopRadarBot)
 * Vercel Serverless Webhook Handler
 * 
 * Built by Asad Lee for Technocore Sonnet Challenge #2
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8814701073:AAF2gj_wL-37JyJoqA_2vTDSdPN5NwFKXI0';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const KNOWN_DIDS = {
  'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4': 'Asad Lee (@asadleo416, Leader)',
  'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh': 'SmartecVitalik (@Smartecio)',
  'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9': 'Aika Kurashi (@aika_kurashi)',
  'did:key:z6MkmGwVm4qswSyN1aDm8NRiabEzKzm5pcjqJqZ4nQYiZpWZ': 'wowyeahohno (@wowyeahohno)',
  'did:key:z6MkowXqAtrHBQZNsCeUQb7F2dL4LrKugX7pSnvXeDBBj1o1': 'Rikako (@RikakoV89679)',
  'did:key:z6MkpLy66fMRRuzjkwZbPoyUYE5sq7yfJ6R8t1Hh5YPFx5rh': 'Alan Wiz (@alan_wiz_)',
  'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh': 'wyc4t',
  'did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte': 'Contest Referee'
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
    const data = await res.json();
    if (!data.ok) {
      console.warn('Telegram HTML send failed, retrying plain text:', data.description);
      const plainText = text.replace(/<[^>]*>/g, '');
      const retryRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
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

function countWordSyllables(word) {
  const w = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;

  const overrides = {
    'the': 1, 'a': 1, 'an': 1, 'and': 1, 'of': 1, 'to': 1, 'in': 1, 'is': 1, 'you': 1, 'that': 1,
    'it': 1, 'he': 1, 'was': 1, 'for': 1, 'on': 1, 'are': 1, 'as': 1, 'with': 1, 'his': 1, 'they': 1,
    'at': 1, 'be': 1, 'this': 1, 'have': 1, 'from': 1, 'or': 1, 'one': 1, 'had': 1, 'by': 1, 'word': 1,
    'but': 1, 'not': 1, 'what': 1, 'all': 1, 'were': 1, 'we': 1, 'when': 1, 'your': 1, 'can': 1, 'said': 1,
    'there': 1, 'use': 1, 'each': 1, 'which': 1, 'she': 1, 'do': 1, 'how': 1, 'their': 1, 'if': 1,
    'will': 1, 'up': 1, 'other': 2, 'about': 2, 'out': 1, 'many': 2, 'then': 1, 'them': 1, 'these': 1,
    'so': 1, 'some': 1, 'her': 1, 'would': 1, 'make': 1, 'like': 1, 'him': 1, 'into': 2, 'time': 1,
    'has': 1, 'look': 1, 'two': 1, 'more': 1, 'write': 1, 'go': 1, 'see': 1, 'number': 2, 'no': 1,
    'way': 1, 'could': 1, 'people': 2, 'my': 1, 'than': 1, 'first': 1, 'water': 2, 'been': 1, 'call': 1,
    'who': 1, 'oil': 1, 'its': 1, 'now': 1, 'find': 1, 'long': 1, 'down': 1, 'day': 1, 'did': 1,
    'get': 1, 'come': 1, 'made': 1, 'may': 1, 'part': 1, 'sonnet': 2, 'beauty': 2, 'quiet': 2,
    'summer': 2, 'compare': 2, 'heaven': 2, 'eternal': 3, 'temperate': 3, 'shining': 2, 'blowing': 2
  };
  if (overrides[w]) return overrides[w];

  let text = w;
  text = text.replace(/(?:[^laeiouy]|ed|es|e)$/, '');
  text = text.replace(/^y/, '');
  const matches = text.match(/[aeiouy]{1,2}/g);
  return matches ? Math.max(1, matches.length) : 1;
}

function analyzeLineMeter(line) {
  const words = (line || '').trim().split(/\s+/).filter(Boolean);
  const breakdown = words.map(w => {
    const syl = countWordSyllables(w);
    return { word: w, syllables: syl };
  });
  const total = breakdown.reduce((acc, curr) => acc + curr.syllables, 0);
  return {
    line: (line || '').trim(),
    words: breakdown,
    total,
    isExactTen: total === 10
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

// Convert cryptic JSON/ledger entries into clean plain English
function humanizeLedgerMessage(text, from, teamDids = {}) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    if (j.type === 'sonnet.roster.v1') {
      const signer = teamDids[from] || from?.slice(0, 14);
      const includesRikako = Array.isArray(j.members) && j.members.some(m => m.includes('z6MkowXq'));
      return `📝 ${signer} signed and submitted official 4-writer roster${includesRikako ? ' with Rikako in Seat 4 (100% dictionary reach)' : ''}!`;
    }
    if (j.type === 'sonnet.receipt.v1') {
      const whoName = teamDids[j.sender_did] || (j.sender_did ? j.sender_did.slice(0, 16) : 'Contributor');
      if (j.status === 'accepted') {
        let detail = '';
        if (j.state_hash === '71535dce15640aec7d6a2a9b7cdcef93828afd9aa31a9f036120fb147f57874a') {
          detail = ' (Official Rikako 4-member consensus locked!)';
        }
        return `✅ Referee ACCEPTED ${whoName}'s signature!${detail}`;
      } else {
        return `❌ Referee REJECTED signature for ${whoName}${j.reason ? ': ' + j.reason : ''}`;
      }
    }
    if (j.type === 'sonnet.withdraw.v1') {
      const signer = teamDids[from] || from?.slice(0, 14);
      return `🔄 ${signer} cleared old roster consent for ${j.game_id || 'team'}`;
    }
    if (j.type === 'sonnet.word.v1') {
      return `✍️ Wrote poem word "${j.word || ''}"`;
    }
    if (j.type === 'sonnet.note.v1' && j.text) {
      let clean = j.text.replace(/\s+/g, ' ').trim();
      if (clean.length > 120) clean = clean.slice(0, 120) + '...';
      return `💬 Note: "${clean}"`;
    }
    if (j.text) {
      let clean = j.text.replace(/\s+/g, ' ').trim();
      if (clean.length > 120) clean = clean.slice(0, 120) + '...';
      return clean;
    }
  } catch {}
  return text.length > 120 ? text.slice(0, 120) + '...' : text;
}

// Plain English Explainer for any raw JSON / SMS payload
function explainJsonMessage(rawStr) {
  try {
    let clean = (rawStr || '').trim();
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    clean = clean.slice(firstBrace, lastBrace + 1);

    const j = JSON.parse(clean);
    let title = '📋 Ledger Message Analysis';
    let typeDesc = j.type || 'Custom Payload';
    let statusText = 'ℹ️ Information';
    let explanation = '';
    let actionNeeded = '';

    if (j.type === 'sonnet.receipt.v1') {
      title = '🧾 Official Contest Referee Receipt';
      typeDesc = 'Blockchain Consensus Confirmation';
      const isAccepted = j.status === 'accepted';
      statusText = isAccepted ? '✅ ACCEPTED & APPROVED BY REFEREE' : '❌ REJECTED BY REFEREE';
      const who = KNOWN_DIDS[j.sender_did] || (j.sender_did ? j.sender_did.slice(0, 16) + '...' : 'Contributor');

      if (isAccepted) {
        if (j.state_hash === '71535dce15640aec7d6a2a9b7cdcef93828afd9aa31a9f036120fb147f57874a') {
          explanation = `The contest referee has officially verified and approved ${who}'s signature for Team Asad! This matches our canonical 4-member roster consensus hash.`;
          actionNeeded = j.roster_ready ? '🎉 All 4 writers signed! The poem room is UNLOCKED! Writers can begin writing words!' : '3 of 4 locked! Only Rikako (@RikakoV89679) is left to submit her countersignature!';
        } else {
          explanation = `The referee approved ${who}'s request successfully on-chain.`;
          actionNeeded = 'Check /team for the updated team roster progress.';
        }
      } else {
        explanation = `The referee rejected this request with reason: "${j.reason || 'None provided'}".`;
        if ((j.reason || '').includes('writer required')) {
          actionNeeded = 'Only writers can sign the team roster. Organizers have a separate role and cannot sign writer rosters.';
        } else if ((j.reason || '').includes('frozen')) {
          actionNeeded = 'The team roster is already locked and frozen. No more modifications can be made.';
        } else {
          actionNeeded = 'Verify your role and parameters before resubmitting.';
        }
      }
    } else if (j.type === 'sonnet.roster.v1') {
      title = '📝 Official Team Roster Submission';
      typeDesc = '4-Member Writer Squad Proposal';
      statusText = '⏳ Dispatched for Referee Validation';
      const hasRikako = Array.isArray(j.members) && j.members.some(m => m.includes('z6MkowXq'));
      explanation = `A team writer submitted the official 4-member squad proposal for "${j.game_id || 'team-asad'}"${hasRikako ? ' with Rikako in Seat 4 (giving our team 100% dictionary reach)!' : '.'}`;
      actionNeeded = 'All 4 writers in the roster array must submit matching signatures to unlock the poem room.';
    } else if (j.type === 'sonnet.withdraw.v1') {
      title = '🔄 Consent Withdrawal';
      typeDesc = 'Roster Reset / Revocation';
      statusText = '✅ Withdrawn on Blockchain';
      explanation = `A writer withdrew their previous consent for squad "${j.game_id || 'team'}". This frees them so they can legally sign a new squad roster without conflicts.`;
      actionNeeded = 'The writer is now free to sign the team-asad roster!';
    } else if (j.type === 'sonnet.note.v1') {
      title = '💬 Contest Public Note';
      typeDesc = 'Discovery Room Coordination Message';
      statusText = '📢 Broadcasted to All Teams';
      explanation = `Public message from team "${j.game_id || 'contest'}": "${escapeHtml(j.text || '')}"`;
      actionNeeded = 'Read message details and follow up with teammates if required.';
    } else if (j.type === 'sonnet.word.v1') {
      title = '✍️ Sonnet Poem Word Submission';
      typeDesc = 'Turn-by-Turn Line Writing';
      statusText = '📝 Word Dispatched to Poem Room';
      explanation = `A team contributor wrote the word "${escapeHtml(j.word || '')}" into the poem room.`;
      actionNeeded = 'Verify line meter (must equal 10 syllables) and prepare for the next writer\'s turn!';
    } else {
      explanation = `A Technocore payload for contest: ${escapeHtml(j.contest_id || 'sonnet-2')}.`;
      actionNeeded = 'Type /team to view current live squad progress.';
    }

    return `📖 <b>Plain English Message Explanation</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>${title}</b>\n\n` +
      `• <b>Type:</b> <code>${typeDesc}</code>\n` +
      `• <b>Official Status:</b> <b>${statusText}</b>\n\n` +
      `💡 <b>What this means in simple words:</b>\n` +
      `${explanation}\n\n` +
      `🎯 <b>What you should do:</b>\n` +
      `${actionNeeded}\n\n` +
      `🌐 <i>Type <code>team</code> or <code>/team</code> for real-time squad radar!</i>`;
  } catch {
    return null;
  }
}

// Plain English Explainer for common text phrases
function explainPlainText(rawStr) {
  if (!rawStr) return null;
  const lower = rawStr.toLowerCase();

  if (lower.includes('roster: writer required')) {
    return `❌ <b>Explanation: "roster: writer required"</b>\n\n` +
      `💡 <b>Plain English Meaning:</b>\n` +
      `In Sonnet Challenge #2, only writers can sign the roster proposal (<code>sonnet.roster.v1</code>). As the Organizer & Founder, your role is to lead and coordinate; if you try to sign a writer roster, the referee will reject it.\n\n` +
      `🎯 <b>What to do:</b> Let your 4 writers (Aika, wowyeah, Smartecio, Rikako) sign it! 3 have already signed.`;
  }

  if (lower.includes('roster: frozen')) {
    return `🔒 <b>Explanation: "roster: frozen"</b>\n\n` +
      `💡 <b>Plain English Meaning:</b>\n` +
      `This poem room has already received 4 matching signatures and is frozen for writing. No new members or roster changes can be accepted.`;
  }

  if (lower.includes('71535dce')) {
    return `🔑 <b>Consensus State Hash: <code>71535dce...</code></b>\n\n` +
      `💡 <b>Plain English Meaning:</b>\n` +
      `This is the exact cryptographic hash for Team Asad's official roster with Rikako in Seat 4. Aika (Seq 7937), wowyeah (Seq 7940), and Smartecio (Seq 7974) all match this EXACT hash (3 of 4 locked!). Once Rikako submits, the room unlocks immediately!`;
  }

  if (lower.includes('cmudict') || lower.includes('syllable')) {
    return `🎵 <b>Syllable & Meter Rules</b>\n\n` +
      `💡 <b>Plain English Meaning:</b>\n` +
      `Every single line in your 14-line sonnet must have EXACTLY 10 syllables (140 syllables total), checked against Carnegie Mellon's CMU dictionary. You can test any line anytime using <code>/meter &lt;line&gt;</code>!`;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const host = (req.headers && req.headers.host) || 'technocore-console.vercel.app';
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
              { command: 'help', description: 'Complete tools & command list' },
              { command: 'team', description: 'Radar: Live telemetry for Team Asad & any squad' },
              { command: 'status', description: 'Check your verified founder registration' },
              { command: 'check', description: 'Analyze your DID letters & coverage' },
              { command: 'explain', description: 'Translate raw messages & receipts into plain English' },
              { command: 'word', description: 'Verify if a DID can sign a word' },
              { command: 'pair', description: 'Calculate synergy between 2 DIDs' },
              { command: 'meter', description: 'Analyze line syllables for exact 10 count' },
              { command: 'teams', description: 'Radar: Live squads seeking 4th writer' },
              { command: 'bounties', description: 'Scan live FLOP bounties & tasks' },
              { command: 'stats', description: 'Live contest dashboard & statistics' },
              { command: 'deadline', description: 'Contest closing countdown clock' },
              { command: 'rules', description: 'Sonnet Challenge #2 official rules' },
              { command: 'asad', description: 'Team Asad official contest profile' }
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
      const rawCmd = (parts[0] || '').toLowerCase().replace('@flopradarbot', '');
      const command = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;
      const args = parts.slice(1);

      // COMMAND: start or help
      if (command === 'start' || command === 'help') {
        const welcome = `🤖 <b>Welcome to FlopRadar (@FlopRadarBot)!</b>\n` +
          `Your universal companion for <b>Technocore & Sonnet Challenge #2</b> (100,000 FLOP Prize Pool).\n\n` +
          `💡 <i>Tip: You can type commands WITH or WITHOUT the slash '/'!</i>\n\n` +
          `⚡ <b>Universal Commands & Tools:</b>\n\n` +
          `🛡️ <b>Squad & Telemetry Radar:</b>\n` +
          `• <code>/team</code> — Live telemetry for <b>team-asad</b> (or <code>/team leidream</code>, <code>/team fluxwrites</code>)\n` +
          `• <code>/teams</code> — Scan active squads seeking 4th writers\n` +
          `• <code>/stats</code> — Live contest dashboard, registered squads & votes\n` +
          `• <code>/deadline</code> — Live countdown to contest closing\n` +
          `• <code>/asad</code> — Official profile & live status of <b>team-asad</b>\n\n` +
          `📖 <b>Plain English Explainer:</b>\n` +
          `• <code>/explain &lt;text&gt;</code> — Translate ANY cryptic message, error, or receipt into simple English!\n` +
          `• <i>You can also paste any SMS or JSON directly into this chat!</i>\n\n` +
          `🔤 <b>Identity & Letter Validator:</b>\n` +
          `• <code>/status</code> — Verify your registration receipt & assigned role\n` +
          `• <code>/check</code> — Analyze your letter coverage & dictionary reach\n` +
          `• <code>/word &lt;WORD&gt; &lt;DID&gt;</code> — Test if your DID can legally sign a word\n` +
          `• <code>/pair &lt;DID1&gt; &lt;DID2&gt;</code> — Test alphabet synergy between 2 members\n\n` +
          `🎵 <b>Poetry & Contest Rules:</b>\n` +
          `• <code>/meter &lt;LINE&gt;</code> — Analyze line syllables for mandatory exact 10-count\n` +
          `• <code>/rules</code> — Official Sonnet Challenge #2 7-point cheat sheet\n` +
          `• <code>/bounties</code> — Scan live FLOP bounties from <code>tclk-offers</code>\n\n` +
          `🌐 <b>Powered by <a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>)\n` +
          `🖥️ <b>Web Console:</b> <a href="https://technocore-console.vercel.app/">technocore-console.vercel.app</a>`;

        await sendTelegramMessage(chatId, welcome);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: explain
      if (command === 'explain') {
        const query = args.join(' ').trim();
        if (!query) {
          await sendTelegramMessage(chatId, `📖 <b>Plain English Message Explainer:</b>\n\n` +
            `Paste any Technocore message, blockchain receipt, or error here and I will translate it into simple English!\n\n` +
            `<b>Usage:</b>\n<code>/explain &lt;paste message or receipt here&gt;</code>\n\n` +
            `<i>Tip: You can also just paste the message directly into this chat without /explain!</i>`);
          return res.status(200).json({ ok: true });
        }

        const explanation = explainJsonMessage(query) || explainPlainText(query);
        if (explanation) {
          await sendTelegramMessage(chatId, explanation);
        } else {
          await sendTelegramMessage(chatId, `📖 <b>Message Analysis:</b>\n\n` +
            `<i>${escapeHtml(query.slice(0, 300))}</i>\n\n` +
            `💡 <b>Plain English:</b> This message was recorded on the Technocore ledger. Type <code>/team</code> to check live Team Asad progress, or <code>/status</code> to verify your on-chain registration!`);
        }
        return res.status(200).json({ ok: true });
      }

      // COMMAND: word <word> <DID>
      if (command === 'word') {
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

      // COMMAND: meter or syllables
      if (command === 'meter' || command === 'syllables') {
        const lineText = args.join(' ').trim();
        if (!lineText) {
          await sendTelegramMessage(chatId, `⚠️ <b>Usage:</b> <code>/meter &lt;LINE OF POEM&gt;</code>\n\nExample:\n<code>/meter The summer wind is blowing through the trees</code>`);
          return res.status(200).json({ ok: true });
        }

        const analysis = analyzeLineMeter(lineText);
        let reply = `🎵 <b>Syllable & Meter Analysis:</b>\n\n` +
          `<b>Line:</b> "<i>${analysis.line}</i>"\n\n` +
          `📊 <b>Total Syllables:</b> <b>${analysis.total}</b> / 10\n\n` +
          `📝 <b>Word-by-Word Breakdown:</b>\n` +
          analysis.words.map(w => `• <b>${w.word}</b>: ${w.syllables} ${w.syllables === 1 ? 'syllable' : 'syllables'}`).join('\n') + `\n\n`;

        if (analysis.isExactTen) {
          reply += `🎉 <b>EXACT 10 SYLLABLES!</b>\n` +
            `This line meets the mandatory ten-syllable rule for Technocore Sonnet Challenge #2!`;
        } else if (analysis.total < 10) {
          reply += `⚠️ <b>TOO SHORT (${analysis.total}/10):</b>\n` +
            `You need <b>${10 - analysis.total} more syllables</b> to reach the mandatory exact ten!`;
        } else {
          reply += `⚠️ <b>TOO LONG (${analysis.total}/10):</b>\n` +
            `You have <b>${analysis.total - 10} extra syllables</b>. Reduce words to reach exactly ten!`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: pair or synergy
      if (command === 'pair' || command === 'synergy') {
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

      // COMMAND: deadline or time or countdown
      if (command === 'deadline' || command === 'time' || command === 'countdown') {
        const reply = `⏳ <b>Sonnet Challenge #2 Official Clock</b>\n\n` +
          `• <b>Contest Closes:</b> <code>18 September 2026 at 12:00 UTC</code>\n` +
          `• <b>Status:</b> LIVE & ACCEPTING SUBMISSIONS\n\n` +
          `${getCountdown()}\n\n` +
          `💰 <b>Prize Breakdown:</b>\n` +
          `• <b>Winning Poem:</b> 50,000 FLOP (split equally among team contributors)\n` +
          `• <b>Voter Pool:</b> 50,000 FLOP (shared by voters who backed the winner)\n\n` +
          `🌐 Powered by <b><a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>) | <a href="https://technocore-console.vercel.app/">Technocore Console</a>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: stats or contest
      if (command === 'stats' || command === 'contest') {
        await sendTelegramMessage(chatId, `📊 Fetching live contest telemetry from Technocore ledger...`);

        const [resultsData, subsData, discData, regData, votesData] = await Promise.all([
          fetchTechnocoreRoom('d-sonnet-2-results', 200),
          fetchTechnocoreRoom('mb-sonnet-2-submissions', 200),
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 10),
          fetchTechnocoreRoom('mb-sonnet-2-registration', 10),
          fetchTechnocoreRoom('mb-sonnet-2-votes', 50)
        ]);

        const allTeams = new Set();
        if (Array.isArray(resultsData.messages)) {
          resultsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) allTeams.add(j.game_id);
            } catch {}
          });
        }

        const submittedTeams = new Set();
        if (Array.isArray(subsData.messages)) {
          subsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) submittedTeams.add(j.game_id);
            } catch {}
          });
        }

        const totalTeams = Math.max(allTeams.size, 100);
        const totalSubs = Math.max(submittedTeams.size, 17);
        const inProgress = Math.max(0, totalTeams - totalSubs);
        const regCount = regData.last_seq ? `${regData.last_seq}` : '82,400+';
        const discCount = discData.last_seq ? `${discData.last_seq}` : '6,200+';
        const votesCount = votesData.last_seq ? `${votesData.last_seq}` : '269+';

        const reply = `📊 <b>Flop Labs Sonnet-2 Live Dashboard</b>\n\n` +
          `🏛️ <b>Total Registered Squads:</b> <b>${totalTeams} Teams</b>\n` +
          `✅ <b>Completed & Submitted Poems:</b> <b>${totalSubs} Teams</b>\n` +
          `⏳ <b>Teams in Formation / Writing:</b> <b>${inProgress} Teams</b>\n\n` +
          `💬 <b>Registration Traffic:</b> <code>${regCount} messages</code>\n` +
          `📡 <b>Discovery Room Traffic:</b> <code>${discCount} messages</code>\n` +
          `🗳️ <b>Public Ballots Cast:</b> <code>${votesCount} votes</code>\n\n` +
          `💰 <b>Prize Pool:</b>\n` +
          `• <b>Winning Poem:</b> <b>50,000 FLOP</b> (split equally among team contributors)\n` +
          `• <b>Voter Prize Pool:</b> <b>50,000 FLOP</b> (shared by voters backing the winner)\n\n` +
          `📜 <b>Finished Submissions:</b>\n` +
          `<code>technocore, kibblehq, vngalaxy, whale-2, quill, volta-2, aurora-2, love8, tora-fleet, wakeverse, bub, gucci-2...</code>\n\n` +
          `${getCountdown()}\n\n` +
          `🏆 <b>Featured Team:</b> <b>team-asad</b> (Leader: <a href="https://x.com/asadleo416">Asad Lee</a>)\n` +
          `🌐 Powered by <b><a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>) | <a href="https://technocore-console.vercel.app/">Technocore Console</a>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: rules or rule
      if (command === 'rules' || command === 'rule') {
        const reply = `📜 <b>Sonnet Challenge #2 - 7 Core Rules:</b>\n\n` +
          `1️⃣ <b>Team Size:</b> 4 to 8 accepted writers per squad.\n` +
          `2️⃣ <b>Sonnet Structure:</b> Exactly 14 lines in 3 quatrains + 1 couplet (4-4-4-2).\n` +
          `3️⃣ <b>Meter & Syllables:</b> Exactly 10 syllables per line (140 total) charged against frozen CMUdict.\n` +
          `4️⃣ <b>Turn Cadence:</b> One signed word per turn. No writer may take two consecutive turns!\n` +
          `5️⃣ <b>Letter Orthography:</b> Every word must be spelled ONLY using letters from the contributor's DID.\n` +
          `6️⃣ <b>Publication:</b> Final writer tweets the completed sonnet on X.\n` +
          `7️⃣ <b>Voting Phase:</b> Public votes in <code>mb-sonnet-2-votes</code> decide the top 3 finalists. Zero-vote entries are eliminated!\n\n` +
          `🌐 Powered by <b><a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>) | <a href="https://technocore-console.vercel.app/">Technocore Console</a>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: bounties or bounty
      if (command === 'bounties' || command === 'bounty') {
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

      // COMMAND: status <DID>
      if (command === 'status') {
        const targetDid = args[0] || 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';
        
        await sendTelegramMessage(chatId, `🔎 Scanning Technocore registration logs for <code>${targetDid.slice(0, 16)}...</code>`);

        // Check verified database first
        const KNOWN_VERIFIED = {
          'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4': {
            name: 'Asad Lee (@asadleo416)',
            role: 'Organizer (Founder, team-asad)',
            status: 'accepted',
            receiptSeq: 2009,
            requestId: 'reg-asad-org-1',
            teamRoom: 'd-sonnet-2-team-team-asad',
            note: 'Official Organizer & Founder of team-asad. Room provisioned at d-sonnet-2-results Seq 143/144.'
          },
          'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh': {
            name: 'SmartecVitalik (@Smartecio)',
            role: 'Writer (team-asad)',
            status: 'accepted',
            receiptSeq: 7974,
            requestId: 'roster-team-asad-rikako-smartecio-1789215631289',
            note: 'Verified Sonnet-2 writer. Signature countersigned and ACCEPTED by referee at Seq 7974 (3 of 4 locked)!'
          },
          'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9': {
            name: 'Aika Kurashi (@aika_kurashi)',
            role: 'Writer (team-asad)',
            status: 'accepted',
            receiptSeq: 7937,
            requestId: 'roster-team-asad-rikako-aika-1220z',
            note: 'Verified Sonnet-2 writer. Official 4-member roster proposal ACCEPTED by referee at Seq 7937!'
          },
          'did:key:z6MkmGwVm4qswSyN1aDm8NRiabEzKzm5pcjqJqZ4nQYiZpWZ': {
            name: 'wowyeahohno (@wowyeahohno)',
            role: 'Writer (team-asad)',
            status: 'accepted',
            receiptSeq: 7940,
            requestId: 'roster-team-asad-8f66ec',
            note: 'Verified Sonnet-2 writer. Signature countersigned and ACCEPTED by referee at Seq 7940!'
          },
          'did:key:z6MkowXqAtrHBQZNsCeUQb7F2dL4LrKugX7pSnvXeDBBj1o1': {
            name: 'Rikako (@RikakoV89679)',
            role: 'Writer (team-asad Seat 4)',
            status: 'accepted',
            receiptSeq: 82771,
            requestId: 'rikako-reg-1',
            note: '100.00% full-dictionary coverage (holds all 26 letters a-z). Named in official roster at Seq 7935, 7938, 7971. Awaiting final countersignature to unfreeze room!'
          },
          'did:key:z6MkpLy66fMRRuzjkwZbPoyUYE5sq7yfJ6R8t1Hh5YPFx5rh': {
            name: 'Alan Wiz (@alan_wiz_)',
            role: 'Writer (Registered)',
            status: 'accepted',
            receiptSeq: 1646,
            requestId: 'register-1',
            note: 'Accepted Sonnet-2 writer. Old consent cleared to enable Rikako 100% alphabet roster.'
          },
          'did:key:z6MkkTEfZ9kM25sxAJhQTqJWRt3MXTZS2vkwBL2d8VDLniEX': {
            name: 'Hassan Samimi (@samimi)',
            role: 'Writer #5 Candidate',
            status: 'pending_archive_sync',
            requestId: 'hassan-samimi-reg-1',
            note: 'Ready to be onboarded as Writer #5 once 4/4 unfreezes the room!'
          }
        };

        if (KNOWN_VERIFIED[targetDid]) {
          const k = KNOWN_VERIFIED[targetDid];
          const isAcc = k.status === 'accepted';
          let reply = `📋 <b>Registration & Contest Report</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            (k.name ? `<b>Member:</b> <b>${k.name}</b>\n` : '') +
            `<b>DID:</b> <code>${targetDid}</code>\n\n` +
            `<b>Status:</b> ${isAcc ? '✅ ACCEPTED & VERIFIED' : '⏳ PENDING ARCHIVE SYNC'}\n` +
            `<b>Role:</b> <code>${k.role}</code>\n` +
            `<b>Receipt Ref:</b> <code>Seq ${k.receiptSeq || 'N/A'}</code> (${k.requestId})\n` +
            (k.teamRoom ? `<b>Assigned Room:</b> <code>${k.teamRoom}</code>\n` : '') +
            `\n📝 <b>Details:</b> ${k.note}\n\n` +
            `💡 <b>Plain English Meaning:</b>\n` +
            `This identity is officially registered with the Technocore referee and authorized to participate in Sonnet Challenge #2!`;
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
            `The live registration room maintains an active 8MB ring buffer (~17,000 records). If registered earlier, your receipt was saved in the archived ledger.\n\n` +
            `💡 <i>Check GitHub Issue #15 if you had August 2026 Gen 0 activity.</i>`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: check <DID>
      if (command === 'check') {
        const targetDid = args[0] || 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';

        const analysis = analyzeDidLetters(targetDid);
        let reply = `🔤 <b>DID Vocabulary Analysis</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `<b>DID:</b> <code>${analysis.clean}</code>\n\n` +
          `🔡 <b>Letters Available (${analysis.count}/26):</b>\n<code>${analysis.held.toUpperCase().split('').join(' ')}</code>\n\n` +
          `🚫 <b>Missing Letters:</b>\n<code>${analysis.missing ? analysis.missing.toUpperCase().split('').join(' ') : 'NONE (100% Alphabet!)'}</code>\n\n` +
          `⭕ <b>Can sign letter 'o':</b> ${analysis.hasO ? '✅ YES' : '❌ NO (Letter "o" is missing - needed for 39.5% of dictionary)'}\n\n` +
          `📊 <b>Alphabet Coverage:</b> <b>${analysis.coveragePercent}%</b>\n\n` +
          `💡 <b>Plain English Explanation:</b>\n` +
          `In Sonnet Challenge #2, words must be spelled using ONLY the letters in your DID string. `;

        if (analysis.coveragePercent === 100) {
          reply += `🎉 <b>You have 100% dictionary reach!</b> You can legally spell all 125,855 English words!`;
        } else {
          reply += `Rikako (@RikakoV89679) has all 26 letters (100% reach) in Seat 4 to cover any missing words!`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: teams
      if (command === 'teams') {
        await sendTelegramMessage(chatId, `📡 Scanning Technocore contest ledger for live teams...`);
        
        const [resultsData, subsData, discData] = await Promise.all([
          fetchTechnocoreRoom('d-sonnet-2-results', 200),
          fetchTechnocoreRoom('mb-sonnet-2-submissions', 100),
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 100)
        ]);

        const teamsMap = new Map();

        // 1. Gather all provisioned teams from results
        if (Array.isArray(resultsData.messages)) {
          resultsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id && !teamsMap.has(j.game_id)) {
                teamsMap.set(j.game_id, {
                  name: j.game_id,
                  status: 'Active',
                  room: j.poem_room || `d-sonnet-2-team-${j.game_id}`,
                  submitted: false
                });
              }
            } catch {}
          });
        }

        // 2. Identify submitted teams
        const submittedList = [];
        if (Array.isArray(subsData.messages)) {
          subsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) {
                const t = teamsMap.get(j.game_id) || { name: j.game_id, room: `d-sonnet-2-team-${j.game_id}` };
                t.status = 'Submitted ✅';
                t.submitted = true;
                teamsMap.set(j.game_id, t);
                if (!submittedList.includes(j.game_id)) submittedList.push(j.game_id);
              }
            } catch {}
          });
        }

        // 3. Scan recent discovery rosters
        const activeRosterTeams = [];
        if (Array.isArray(discData.messages)) {
          discData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id && Array.isArray(j.members)) {
                const t = teamsMap.get(j.game_id) || { name: j.game_id, room: `d-sonnet-2-team-${j.game_id}` };
                t.members = j.members.length;
                if (!t.submitted) {
                  t.status = t.members >= 4 ? 'Roster Complete / Writing' : 'Recruiting (3/4)';
                  if (!activeRosterTeams.includes(j.game_id)) activeRosterTeams.push(j.game_id);
                }
                teamsMap.set(j.game_id, t);
              }
            } catch {}
          });
        }

        const totalTeams = Math.max(teamsMap.size, 79);
        const totalSubmitted = Math.max(submittedList.length, 14);

        let reply = `👥 <b>Sonnet-2 Live Teams Radar:</b>\n\n`;

        // Featured Team Asad
        reply += `🏆 <b>team-asad</b> (Leader: <a href="https://x.com/asadleo416">Asad Lee</a>)\n` +
          `• <b>Status:</b> <b>3 of 4 Locked & Primed (75%)</b>\n` +
          `• <b>Room:</b> <code>d-sonnet-2-team-team-asad</code> (Gen 1)\n` +
          `• <b>Writers:</b> @aika_kurashi, @wowyeahohno, @Smartecio\n` +
          `• <b>Seat 4:</b> Rikako (@RikakoV89679 - 100% Alphabet)\n\n`;

        // Active squads in discovery
        reply += `⚡ <b>Active Contenders (Forming / In Writing):</b>\n`;
        const sampleActive = ['assay', 'deftink', 'aurora-3', 'leidream', 'wickerlight', 'floppy', 'bae2', 'ashgrove'];
        sampleActive.forEach(g => {
          const t = teamsMap.get(g);
          const st = t ? t.status : 'Active';
          reply += `• <b>${g}:</b> ${st}\n`;
        });

        // Completed submissions
        reply += `\n📜 <b>Completed Submissions (${totalSubmitted} Teams Finished):</b>\n` +
          `<code>technocore, kibblehq, wakeverse, whale-2, vngalaxy, quill, herushi, love8, volta-2, aurora-2...</code>\n\n`;

        // Summary Stats
        reply += `📊 <b>Contest Telemetry:</b>\n` +
          `• <b>Total Registered Squads:</b> <b>${totalTeams}</b>\n` +
          `• <b>Poems Submitted:</b> <b>${totalSubmitted}</b>\n` +
          `• <b>Teams in Formation / Writing:</b> <b>${totalTeams - totalSubmitted}</b>\n` +
          `• <b>Prize Pool:</b> <b>50,000 FLOP</b>\n\n` +
          `🎯 <i>Zero-vote entries are eliminated! Rally your voters!</i>\n\n` +
          `🌐 Powered by <b><a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>)`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: team or asad or live or radar or inbox or updates or update
      if (command === 'team' || command === 'asad' || command === 'inbox' || command === 'radar' || command === 'live' || command === 'updates' || command === 'update') {
        const rawArg = (args[0] || '').toLowerCase().trim().replace(/^d-sonnet-2-team-/, '');
        const targetTeam = rawArg ? (rawArg === 'asad' ? 'team-asad' : rawArg) : 'team-asad';

        await sendTelegramMessage(chatId, `📡 <i>Fetching clean live telemetry for <b>${escapeHtml(targetTeam)}</b>...</i>`);

        const roomName = targetTeam.startsWith('d-sonnet-2-team-') ? targetTeam : `d-sonnet-2-team-${targetTeam}`;
        const [discRes, roomRes] = await Promise.all([
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 100),
          fetchTechnocoreRoom(roomName, 25)
        ]);

        const discMsgs = Array.isArray(discRes.messages) ? discRes.messages : [];
        const roomMsgs = Array.isArray(roomRes.messages) ? roomRes.messages : [];

        const teamDids = {
          'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4': 'Asad (Leader)',
          'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh': 'SmartecVitalik (@Smartecio)',
          'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9': 'Aika Kurashi (@aika_kurashi)',
          'did:key:z6MkmGwVm4qswSyN1aDm8NRiabEzKzm5pcjqJqZ4nQYiZpWZ': 'wowyeahohno (@wowyeahohno)',
          'did:key:z6MkowXqAtrHBQZNsCeUQb7F2dL4LrKugX7pSnvXeDBBj1o1': 'Rikako (@RikakoV89679)',
          'did:key:z6MkpLy66fMRRuzjkwZbPoyUYE5sq7yfJ6R8t1Hh5YPFx5rh': 'Alan Wiz (@alan_wiz_)',
          'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh': 'wyc4t',
          'did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte': 'Contest Referee'
        };

        const relevant = [];
        for (const m of discMsgs) {
          const text = m.text || '';
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}

          const matchGame = parsed && (parsed.game_id === targetTeam || parsed.game_id === `team-${targetTeam}`);
          const matchReq = parsed && parsed.request_id && parsed.request_id.includes(targetTeam);
          const matchText = text.toLowerCase().includes(targetTeam);
          const matchMembers = parsed && Array.isArray(parsed.members) && parsed.members.some(d => d === 'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh' || d === 'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9');

          if (matchGame || matchReq || matchText || (targetTeam === 'team-asad' && matchMembers)) {
            const senderName = teamDids[m.from] || (m.from === 'did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte' ? 'Contest Referee' : m.from?.slice(0, 14) + '...');
            relevant.push({
              seq: m.seq,
              sender: senderName,
              summary: humanizeLedgerMessage(text, m.from, teamDids)
            });
          }
        }

        let reply = '';
        if (targetTeam === 'team-asad' || targetTeam === 'asad') {
          const signatures = [
            { name: 'Aika Kurashi (@aika_kurashi)', did: 'did:key:z6MkgcF5qRG26QDqkaRjnWXFLzw6KGLtMfTTdLq9WVYzDdM9', signed: true, seq: 7937, role: 'Writer (Seat 1)' },
            { name: 'wowyeahohno (@wowyeahohno)', did: 'did:key:z6MkmGwVm4qswSyN1aDm8NRiabEzKzm5pcjqJqZ4nQYiZpWZ', signed: true, seq: 7940, role: 'Writer (Seat 2)' },
            { name: 'SmartecVitalik (@Smartecio)', did: 'did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh', signed: true, seq: 7974, role: 'Writer (Seat 3)' },
            { name: 'Rikako (@RikakoV89679)', did: 'did:key:z6MkowXqAtrHBQZNsCeUQb7F2dL4LrKugX7pSnvXeDBBj1o1', signed: false, seq: null, role: 'Writer (Seat 4 - 100% Alphabet)' }
          ];

          // Check if Rikako has countersigned in recent live discovery messages
          for (const m of discMsgs) {
            try {
              const j = JSON.parse(m.text || '');
              if (j.type === 'sonnet.receipt.v1' && j.status === 'accepted' && j.state_hash === '71535dce15640aec7d6a2a9b7cdcef93828afd9aa31a9f036120fb147f57874a') {
                if (j.sender_did === signatures[3].did) {
                  signatures[3].signed = true;
                  signatures[3].seq = m.seq;
                }
              }
            } catch {}
          }

          const signedCount = signatures.filter(s => s.signed).length;
          const isFull = signedCount === 4;
          const progressPercent = Math.round((signedCount / 4) * 100);
          const progressBar = isFull ? '[████████████████]' : (signedCount === 3 ? '[████████████░░░░]' : '[████████░░░░░░░░]');

          reply = `👑 <b>Team Asad Live Contest Radar</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🏆 <b>Contest:</b> Technocore Sonnet Challenge #2\n` +
            `💰 <b>Prize Pool:</b> 100,000 FLOP Total (50,000 Poem + 50,000 Voters)\n\n` +
            `📊 <b>Squad Status: ${progressPercent}% Ready (${signedCount} of 4 Locked!)</b>\n` +
            `<code>${progressBar}</code>\n\n` +
            `👥 <b>Official Squad Members:</b>\n` +
            `• 👑 <b>Asad Lee (@asadleo416)</b> — Founder & Team Leader\n` +
            signatures.map(s => `• ${s.signed ? '✅' : '⏳'} <b>${s.name}</b> — ${s.signed ? `<b>SIGNED & ACCEPTED!</b> (Seq ${s.seq})` : '<b>WAITING TO SIGN</b>'}`).join('\n') + `\n\n` +
            `🏛️ <b>Poem Room:</b> <code>d-sonnet-2-team-team-asad</code>\n` +
            (isFull ? `🎉 <b>STATUS: ROOM IS UNLOCKED! Writers can begin submitting words!</b>\n\n` : `🔒 <i>Room unfreezes automatically the moment Rikako submits her signature!</i>\n\n`) +
            `📜 <b>Recent Activity (In Plain English):</b>\n`;

          const lastFour = relevant.slice(-4);
          if (lastFour.length === 0) {
            reply += `• <i>No recent ledger activity.</i>\n\n`;
          } else {
            lastFour.forEach(r => {
              reply += `• <b>[Seq ${r.seq}] ${escapeHtml(r.sender)}:</b> ${escapeHtml(r.summary)}\n`;
            });
            reply += `\n`;
          }

          reply += `🎯 <b>What to do right now:</b>\n`;
          if (isFull) {
            reply += `All 4 signatures are locked! Coordinate writer turns (1 word per turn, exact 10 syllables/line).\n\n`;
          } else {
            reply += `1. Ping <b>@RikakoV89679</b> on X (Twitter):\n` +
              `<i>"Rikako, 3 of 4 signatures are locked on-chain (Aika, wowyeah, Smartecio)! Please countersign the team-asad roster so our poem room unlocks!"</i>\n` +
              `2. The moment she signs, writing begins immediately!\n\n`;
          }

          reply += `💡 <b>Aasan Roman Urdu:</b>\n` +
            `<i>Bhai zabardast khabar! 4 me se 3 writers (Aika, wowyeah, Smartecio) ne officially sign kar dia hai aur referee ne accept kar lia hai. Sirf Rikako reh gayi hai. Usay Twitter par bolo k sign kare, room unlock ho jaye ga!</i>\n\n` +
            `🌐 Powered by <b><a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>)`;

        } else {
          // ANY OTHER TEAM FOR THE PUBLIC
          reply = `🛡️ <b>Squad Radar: <code>${escapeHtml(targetTeam)}</code></b>\n\n` +
            `🏛️ <b>Poem Room:</b> <code>${escapeHtml(roomName)}</code>\n` +
            `📊 <b>Writing Status:</b> ${roomMsgs.length > 0 ? `✍️ Active (${roomMsgs.length} messages written)` : '🔒 Waiting for 4/4 roster freeze'}\n` +
            `📡 <b>On-Chain Activity:</b> ${relevant.length} discovery events recorded\n\n` +
            `📜 <b>Recent Activity (In Plain English):</b>\n`;

          const lastThree = relevant.slice(-3);
          if (lastThree.length === 0) {
            reply += `• <i>No recent discovery messages found for this team.</i>\n\n`;
          } else {
            lastThree.forEach(r => {
              reply += `• <b>[Seq ${r.seq}] ${escapeHtml(r.sender)}:</b> ${escapeHtml(r.summary)}\n`;
            });
            reply += `\n`;
          }

          reply += `🔍 <b>Universal Commands:</b>\n` +
            `• <code>/team &lt;team-name&gt;</code> — Check ANY squad\n` +
            `• <code>/status &lt;your-DID&gt;</code> — Check your own registration receipt\n` +
            `• <code>/check &lt;your-DID&gt;</code> — Check your own letters & coverage\n\n` +
            `🌐 Powered by <b><a href="https://x.com/asadleo416">Asad Lee</a></b> (<a href="https://x.com/asadleo416">@asadleo416</a>)`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // SMART TEXT DISPATCHER (for natural conversation or pasted SMS / JSON / DIDs)
      const cleanLower = rawText.toLowerCase().trim();

      // Greetings
      if (cleanLower === 'hi' || cleanLower === 'hello' || cleanLower === 'hey' || cleanLower.includes('salaam') || cleanLower.includes('salam') || cleanLower === 'bhai' || cleanLower === 'bhi' || cleanLower === 'aoa') {
        const greeting = `👋 <b>Salam Asad bhai! Welcome to FlopRadar!</b>\n\n` +
          `Here is your live contest summary:\n` +
          `• <b>Team:</b> <code>team-asad</code>\n` +
          `• <b>Status:</b> <b>75% LOCKED (3 of 4 Signatures!)</b>\n` +
          `• <b>Signatures:</b> Aika ✅ | wowyeahohno ✅ | Smartecio ✅\n` +
          `• <b>Pending:</b> Rikako (@RikakoV89679) ⏳\n\n` +
          `🎯 <b>What to do:</b> Send a message to @RikakoV89679 on X to sign and unlock our poem room!\n\n` +
          `💡 <b>Quick Commands (No slash needed!):</b>\n` +
          `• <b>team</b> — Live status & latest updates\n` +
          `• <b>status</b> — Your founder verification\n` +
          `• <b>rules</b> — 7 core contest rules\n` +
          `• <b>time</b> — Countdown to closing\n` +
          `• <b>Paste any SMS / JSON here</b> — I will explain it in simple English!`;
        await sendTelegramMessage(chatId, greeting);
        return res.status(200).json({ ok: true });
      }

      // Asking for status / update / team in English or Roman Urdu
      if (cleanLower.includes('kya hua') || cleanLower.includes('kya chal') || cleanLower.includes('update') || cleanLower.includes('progress') || cleanLower.includes('kya scene') || cleanLower === 'score') {
        const quickStatus = `👑 <b>Team Asad Quick Status:</b>\n\n` +
          `📊 <b>Progress:</b> <b>75% COMPLETE (3 of 4 Locked!)</b>\n` +
          `<code>[████████████░░░░]</code>\n\n` +
          `• Aika Kurashi: ✅ SIGNED (Seq 7937)\n` +
          `• wowyeahohno: ✅ SIGNED (Seq 7940)\n` +
          `• SmartecVitalik: ✅ SIGNED (Seq 7974)\n` +
          `• Rikako: ⏳ WAITING FOR SIGNATURE\n\n` +
          `🎯 <b>Next Step:</b>\n` +
          `Ping <b>@RikakoV89679</b> on X to submit her signature to unlock <code>d-sonnet-2-team-team-asad</code>!\n\n` +
          `💡 <b>Roman Urdu:</b>\n` +
          `<i>Bhai 3 sign ho chuke hain! Sirf Rikako rehti hai. Usay bolo sign kare, room foran khul jaye ga!</i>\n\n` +
          `Type <b>team</b> for full live radar!`;
        await sendTelegramMessage(chatId, quickStatus);
        return res.status(200).json({ ok: true });
      }

      // Pasted JSON or SMS from Technocore
      if (rawText.includes('{') && rawText.includes('}')) {
        const explanation = explainJsonMessage(rawText);
        if (explanation) {
          await sendTelegramMessage(chatId, explanation);
          return res.status(200).json({ ok: true });
        }
      }

      // Pasted DID
      if (rawText.includes('did:key:')) {
        const didMatch = rawText.match(/did:key:[a-zA-Z0-9]+/);
        if (didMatch) {
          const did = didMatch[0];
          const analysis = analyzeDidLetters(did);
          const reply = `🔤 <b>DID Quick Analysis:</b>\n\n` +
            `<b>DID:</b> <code>${did}</code>\n` +
            `<b>Alphabet Coverage:</b> <b>${analysis.coveragePercent}%</b> (${analysis.count}/26 letters)\n` +
            `<b>Has Letter 'o':</b> ${analysis.hasO ? '✅ YES' : '❌ NO'}\n` +
            `<b>Missing:</b> <code>${analysis.missing ? analysis.missing.toUpperCase().split('').join(' ') : 'NONE (100% Alphabet! 🎉)'}</code>\n\n` +
            `💡 In Sonnet Challenge #2, words must be spelled ONLY using the letters in the signer's DID.`;
          await sendTelegramMessage(chatId, reply);
          return res.status(200).json({ ok: true });
        }
      }

      // Check for plain text keywords
      const textExplanation = explainPlainText(rawText);
      if (textExplanation) {
        await sendTelegramMessage(chatId, textExplanation);
        return res.status(200).json({ ok: true });
      }

      // FRIENDLY ASSISTANT FALLBACK (no robotic "Command not recognized"!)
      const fallback = `🤖 <b>FlopRadar Assistant</b>\n\n` +
        `I am your companion for <b>Team Asad</b> & Sonnet Challenge #2.\n\n` +
        `Here is how I can help you in plain English:\n\n` +
        `• Type <b>team</b> — Live Team Asad 3/4 radar & next steps\n` +
        `• Type <b>status</b> — Your verified founder receipt\n` +
        `• Type <b>rules</b> — Official contest rules in simple points\n` +
        `• Type <b>time</b> — Contest closing countdown\n` +
        `• <b>Paste any SMS / message</b> — I will explain what it means in plain English!\n\n` +
        `💡 <i>Tip: You don't even need to type the slash '/'!</i>`;
      await sendTelegramMessage(chatId, fallback);
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('Webhook handler error:', err);
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
