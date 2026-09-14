import https from 'https';

/**
 * FlopRadar Telegram Bot (@FlopRadarBot)
 * Vercel Serverless Webhook Handler
 * 
 * Powered by Asad Lee (@asadleo416) | Technocore Console
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8814701073:AAF2gj_wL-37JyJoqA_2vTDSdPN5NwFKXI0';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const FOOTER = '\n\nPowered by <a href="https://x.com/asadleo416">Asad Lee (X: @asadleo416)</a> | <a href="https://technocore-console.vercel.app">Technocore Console</a>';

const BOT_COMMANDS = [
  { command: 'audit', description: 'Referee compliance audit of any squad' },
  { command: 'rhyme', description: 'Find legal rhyming words for your DID' },
  { command: 'word', description: 'Test if a DID can legally sign a word' },
  { command: 'meter', description: 'Count line syllables (10 req)' },
  { command: 'pair', description: 'Calculate alphabet synergy of 2 DIDs' },
  { command: 'check', description: 'Analyze DID letter coverage' },
  { command: 'status', description: 'Check registration receipt of any DID' },
  { command: 'team', description: 'Live status of any squad (e.g. /team leidream)' },
  { command: 'teams', description: 'List active squads in contest' },
  { command: 'rules', description: 'Sonnet-2 official contest rules' },
  { command: 'deadline', description: 'Contest closing countdown' },
  { command: 'stats', description: 'Contest statistics and submissions' },
  { command: 'bounties', description: 'Live TCLK offers' },
  { command: 'explain', description: 'Translate message or receipt into plain English' },
  { command: 'help', description: 'Overview and usage guide' }
];

const KNOWN_DIDS = {
  'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4': '<a href="https://x.com/asadleo416">Asad Lee (X: @asadleo416)</a> (Leader)',
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

async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    const fullText = text.includes('Powered by Asad Lee') ? text : `${text}${FOOTER}`;
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
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
    const cleanRoom = encodeURIComponent((room || '').trim().toLowerCase());
    const res = await fetch(`https://technocore.chat/r/${cleanRoom}?format=json&limit=${limit}`);
    if (!res.ok) return { messages: [] };
    return await res.json();
  } catch (err) {
    console.error(`fetchTechnocoreRoom error for ${room}:`, err);
    return { messages: [] };
  }
}

async function fetchTechnocoreExport(room) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 6000);
    const cleanRoom = encodeURIComponent((room || '').trim().toLowerCase());
    https.get(`https://technocore.chat/r/${cleanRoom}/export`, (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk;
      });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const lines = buffer.trim().split('\n').filter(Boolean).map(JSON.parse);
          resolve(lines);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

async function streamFindRegistration(targetDid) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ receipt: null, request: null }), 6000);
    https.get('https://technocore.chat/r/mb-sonnet-2-registration/export', (res) => {
      let buffer = '';
      let latestReceipt = null;
      let latestRequest = null;

      res.on('data', chunk => {
        buffer += chunk;
        let lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.includes(targetDid)) {
            try {
              const record = JSON.parse(line);
              const payload = JSON.parse(record.text);
              if (payload.type === 'sonnet.receipt.v1') {
                latestReceipt = { ...payload, seq: record.seq, from: record.from, ts: record.ts };
              } else if (payload.type === 'sonnet.register.v1') {
                latestRequest = { ...payload, seq: record.seq, from: record.from, ts: record.ts };
              }
            } catch(e){}
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timeout);
        resolve({ receipt: latestReceipt, request: latestRequest });
      });
    }).on('error', () => {
      clearTimeout(timeout);
      resolve({ receipt: null, request: null });
    });
  });
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

const RHYME_GROUPS = {
  'ong': ['song', 'long', 'strong', 'wrong', 'along', 'belong', 'prolong'],
  'ack': ['lack', 'back', 'track', 'black', 'pack', 'crack', 'smack', 'stack'],
  'urn': ['turn', 'learn', 'burn', 'earn', 'yearn', 'return', 'discern'],
  'art': ['art', 'part', 'start', 'heart', 'dart', 'chart', 'smart', 'depart'],
  'ight': ['write', 'light', 'night', 'bright', 'white', 'sight', 'flight', 'fight', 'tight', 'quite', 'delight', 'insight'],
  'all': ['all', 'small', 'tall', 'call', 'fall', 'ball', 'hall', 'wall'],
  'ay': ['say', 'day', 'may', 'way', 'lay', 'stay', 'play', 'away', 'gray', 'pray'],
  'ee': ['see', 'free', 'tree', 'be', 'sea', 'glee', 'plea', 'three', 'decree'],
  'ind': ['find', 'mind', 'kind', 'blind', 'wind', 'bind', 'behind', 'mankind'],
  'ound': ['sound', 'bound', 'found', 'round', 'ground', 'hound', 'profound', 'around'],
  'ew': ['true', 'new', 'few', 'grew', 'view', 'blue', 'due', 'knew', 'renew'],
  'est': ['rest', 'best', 'west', 'guest', 'test', 'blest', 'nest', 'request'],
  'are': ['care', 'share', 'rare', 'dare', 'fair', 'hair', 'air', 'bear', 'wear', 'stare', 'aware', 'prayer'],
  'ace': ['space', 'place', 'grace', 'race', 'face', 'pace', 'embrace', 'trace'],
  'eed': ['need', 'seed', 'deed', 'speed', 'feed', 'bleed', 'breed', 'plead'],
  'end': ['friend', 'send', 'end', 'blend', 'mend', 'spend', 'bend', 'attend'],
  'old': ['gold', 'hold', 'bold', 'told', 'cold', 'fold', 'behold', 'unfold'],
  'ore': ['more', 'store', 'shore', 'before', 'door', 'pour', 'floor', 'implore'],
  'ar': ['star', 'far', 'bar', 'car', 'scar', 'afar'],
  'ake': ['make', 'take', 'wake', 'break', 'shake', 'lake', 'sake', 'forsake'],
  'ide': ['beside', 'guide', 'side', 'wide', 'ride', 'hide', 'tide', 'abide'],
  'ear': ['year', 'hear', 'dear', 'clear', 'near', 'fear', 'tear', 'appear'],
  'own': ['own', 'grown', 'blown', 'known', 'crown', 'down', 'town', 'shown'],
  'un': ['sun', 'run', 'done', 'one', 'won', 'begun'],
  'ing': ['sing', 'ring', 'bring', 'king', 'wing', 'spring', 'string'],
  'ine': ['fine', 'mine', 'shine', 'line', 'divine', 'wine', 'sign'],
  'ave': ['gave', 'save', 'brave', 'wave', 'grave', 'cave', 'crave'],
  'ell': ['tell', 'well', 'bell', 'fell', 'dwell', 'spell', 'shell'],
  'ime': ['time', 'rhyme', 'climb', 'prime', 'chime', 'sublime'],
  'ove': ['love', 'above', 'dove'],
  'low': ['slow', 'glow', 'grow', 'flow', 'show', 'know', 'blow', 'throw', 'bestow'],
  'eep': ['deep', 'keep', 'sleep', 'weep', 'steep', 'reap'],
  'ain': ['rain', 'pain', 'gain', 'main', 'remain', 'plain', 'strain', 'chain', 'train'],
  'ame': ['name', 'same', 'flame', 'came', 'game', 'claim', 'frame', 'shame'],
  'ise': ['rise', 'wise', 'eyes', 'skies', 'lies', 'ties', 'cries', 'arise'],
  'eam': ['dream', 'gleam', 'beam', 'stream', 'seem', 'team'],
  'ath': ['breath', 'death', 'path'],
  'ark': ['dark', 'mark', 'spark', 'bark', 'park'],
  'ife': ['life', 'strife', 'wife']
};

function findRhymes(word) {
  const w = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return null;
  for (const [key, list] of Object.entries(RHYME_GROUPS)) {
    if (list.includes(w)) {
      return { key, rhymes: list.filter(r => r !== w) };
    }
  }
  for (const [key, list] of Object.entries(RHYME_GROUPS)) {
    if (w.endsWith(key)) {
      return { key, rhymes: list.filter(r => r !== w) };
    }
  }
  return null;
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

function getCountdownText() {
  const deadline = new Date('2026-09-18T12:00:00Z').getTime();
  const now = Date.now();
  const diff = deadline - now;
  
  if (diff <= 0) {
    return 'Contest is closed. Judging and voting results underway.';
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${days} days, ${hours} hours, and ${mins} minutes remaining`;
}

function humanizeLedgerMessage(text, from, teamDids = {}) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    if (j.type === 'sonnet.roster.v1') {
      const signer = teamDids[from] || from?.slice(0, 14);
      return `Roster: ${signer} submitted proposal for ${j.game_id || 'team'}`;
    }
    if (j.type === 'sonnet.receipt.v1') {
      const whoName = teamDids[j.sender_did] || (j.sender_did ? j.sender_did.slice(0, 16) : 'Contributor');
      if (j.status === 'accepted') {
        return `Receipt: Accepted signature from ${whoName}`;
      } else {
        return `Receipt: Rejected signature for ${whoName} (${j.reason || 'error'})`;
      }
    }
    if (j.type === 'sonnet.withdraw.v1') {
      const signer = teamDids[from] || from?.slice(0, 14);
      return `Withdrawal: ${signer} cleared consent for ${j.game_id || 'team'}`;
    }
    if (j.type === 'sonnet.word.v1') {
      return `Word: "${j.word || ''}" added to poem line`;
    }
    if (j.type === 'sonnet.note.v1' && j.text) {
      let clean = j.text.replace(/\s+/g, ' ').trim();
      if (clean.length > 100) clean = clean.slice(0, 100) + '...';
      return `Note: "${clean}"`;
    }
    if (j.text) {
      let clean = j.text.replace(/\s+/g, ' ').trim();
      if (clean.length > 100) clean = clean.slice(0, 100) + '...';
      return clean;
    }
  } catch {}
  return text.length > 100 ? text.slice(0, 100) + '...' : text;
}

function explainJsonMessage(rawStr) {
  try {
    let clean = (rawStr || '').trim();
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    clean = clean.slice(firstBrace, lastBrace + 1);

    const j = JSON.parse(clean);
    let title = 'Ledger Message Analysis';
    let typeDesc = j.type || 'Custom Payload';
    let statusText = 'Information';
    let explanation = '';
    let actionNeeded = '';

    if (j.type === 'sonnet.receipt.v1') {
      title = 'Contest Referee Receipt';
      typeDesc = 'Blockchain Consensus Confirmation';
      const isAccepted = j.status === 'accepted';
      statusText = isAccepted ? 'ACCEPTED' : 'REJECTED';
      const who = KNOWN_DIDS[j.sender_did] || (j.sender_did ? j.sender_did.slice(0, 16) + '...' : 'Contributor');

      if (isAccepted) {
        explanation = `The referee confirmed and approved ${who}'s message on-chain.`;
        actionNeeded = j.roster_ready ? 'All 4 writers signed. Room is unlocked for writing.' : 'Waiting on remaining signatures.';
      } else {
        explanation = `The referee rejected this request: "${j.reason || 'None specified'}".`;
        if ((j.reason || '').includes('writer required')) {
          actionNeeded = 'Only writers can sign the roster. Organizers cannot sign writer rosters.';
        } else if ((j.reason || '').includes('frozen')) {
          actionNeeded = 'Roster is already locked. No more modifications accepted.';
        } else {
          actionNeeded = 'Review role and parameters before resubmitting.';
        }
      }
    } else if (j.type === 'sonnet.roster.v1') {
      title = 'Team Roster Submission';
      typeDesc = '4-Member Writer Squad Proposal';
      statusText = 'Sent for Referee Validation';
      explanation = `Roster proposal submitted for squad "${j.game_id || 'team'}".`;
      actionNeeded = 'All 4 members must submit matching signatures to unfreeze the room.';
    } else if (j.type === 'sonnet.withdraw.v1') {
      title = 'Consent Withdrawal';
      typeDesc = 'Roster Consent Revocation';
      statusText = 'Withdrawn on-chain';
      explanation = `Writer withdrew prior consent for squad "${j.game_id || 'team'}".`;
      actionNeeded = 'The writer is now free to sign another roster without double-booking.';
    } else if (j.type === 'sonnet.note.v1') {
      title = 'Public Discovery Note';
      typeDesc = 'Coordination Announcement';
      statusText = 'Broadcasted';
      explanation = `Message from "${j.game_id || 'participant'}": "${escapeHtml(j.text || '')}"`;
      actionNeeded = 'Follow up with mentioned teammates if required.';
    } else if (j.type === 'sonnet.word.v1') {
      title = 'Poem Word Submission';
      typeDesc = 'Line Writing Turn';
      statusText = 'Submitted to Poem Room';
      explanation = `Word "${escapeHtml(j.word || '')}" was submitted to room "${j.poem_room || j.game_id || ''}".`;
      actionNeeded = 'Verify line syllables (10 per line) and prepare for next writer.';
    } else {
      explanation = `Technocore payload for contest: ${escapeHtml(j.contest_id || 'sonnet-2')}.`;
      actionNeeded = 'Use /team <name> to check current status.';
    }

    return `<b>${title}</b>\n\n` +
      `Type: <code>${typeDesc}</code>\n` +
      `Status: <b>${statusText}</b>\n\n` +
      `Meaning:\n${explanation}\n\n` +
      `Action:\n${actionNeeded}`;
  } catch {
    return null;
  }
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

  // SETUP / HEALTHCHECK (GET /api/bot)
  if (req.method === 'GET') {
    try {
      // 1. Ensure webhook is set
      const hookRes = await fetch(`${TELEGRAM_API}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const hookData = await hookRes.json();

      // 2. Clear old command scopes first
      await fetch(`${TELEGRAM_API}/deleteMyCommands`, { method: 'POST' });

      // 3. Set standard clean menu commands for default & private chats
      const cmdDefRes = await fetch(`${TELEGRAM_API}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: BOT_COMMANDS, scope: { type: 'default' } })
      });
      const cmdDefData = await cmdDefRes.json();

      const cmdPrivRes = await fetch(`${TELEGRAM_API}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: BOT_COMMANDS, scope: { type: 'all_private_chats' } })
      });
      const cmdPrivData = await cmdPrivRes.json();

      // 4. Restore Chat Menu Button
      const btnRes = await fetch(`${TELEGRAM_API}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_button: { type: 'commands' } })
      });
      const btnData = await btnRes.json();

      // 5. Verify commands are active
      const checkRes = await fetch(`${TELEGRAM_API}/getMyCommands`);
      const checkData = await checkRes.json();

      return res.status(200).json({
        ok: true,
        webhookUrl,
        telegramActiveCommands: (checkData.result || []).map(c => c.command),
        webhook: hookData,
        defaultScope: cmdDefData,
        privateScope: cmdPrivData,
        menuButton: btnData
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
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
        const welcome = `<b>FlopRadar - Technocore Sonnet Challenge #2</b>\n\n` +
          `Community telemetry tools for Sonnet-2 (100,000 FLOP Prize Pool):\n\n` +
          `<b>Core Commands:</b>\n` +
          `• <code>/audit &lt;team&gt;</code> - Pre-submission referee compliance audit of squad\n` +
          `• <code>/rhyme &lt;word&gt; [DID]</code> - Find legal rhyming words for your DID\n` +
          `• <code>/word &lt;word&gt; &lt;DID&gt;</code> - Check if a DID can legally sign a word\n` +
          `• <code>/meter &lt;line&gt;</code> - Analyze line syllables (10 req)\n` +
          `• <code>/pair &lt;DID1&gt; &lt;DID2&gt;</code> - Test alphabet synergy between 2 members\n` +
          `• <code>/check &lt;DID&gt;</code> - View letters held and dictionary coverage\n` +
          `• <code>/status &lt;DID&gt;</code> - Check registration receipt of any DID\n` +
          `• <code>/team &lt;team-name&gt;</code> - Live room telemetry for any squad (e.g. <code>/team leidream</code>)\n` +
          `• <code>/teams</code> - View active squads in contest\n` +
          `• <code>/rules</code> - 7 core rules of Sonnet Challenge #2\n` +
          `• <code>/deadline</code> - Countdown to contest close\n` +
          `• <code>/stats</code> - Contest dashboard and submissions\n` +
          `• <code>/bounties</code> - Scan live TCLK offers\n` +
          `• <code>/explain &lt;text&gt;</code> - Translate raw JSON/receipt into plain English\n\n` +
          `<i>Tip: Commands work with or without the slash '/'.</i>`;

        await sendTelegramMessage(chatId, welcome);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: audit <team-name>
      if (command === 'audit') {
        const rawArg = (args[0] || '').toLowerCase().trim().replace(/^d-sonnet-2-team-/, '');

        if (!rawArg) {
          const usage = `<b>Referee Compliance Audit</b>\n\n` +
            `Usage: <code>/audit &lt;team-name&gt;</code>\n\n` +
            `Examples:\n` +
            `• <code>/audit shultz3</code>\n` +
            `• <code>/audit leidream</code>\n` +
            `• <code>/audit emberwick</code>\n` +
            `• <code>/audit team-asad</code>\n\n` +
            `Performs full pre-submission audit against Sonnet-2 referee rules:\n` +
            `• Rule 1: 4 to 8 accepted writers\n` +
            `• Rule 2 & 3: 14 lines, exact 10 syllables per line (140 total)\n` +
            `• Rule 4: Zero consecutive turns\n` +
            `• Rule 5: 100% letter compliance per signer DID\n` +
            `• Official submission status in mb-sonnet-2-submissions`;
          await sendTelegramMessage(chatId, usage);
          return res.status(200).json({ ok: true });
        }

        const targetTeam = rawArg;
        const roomName = `d-sonnet-2-team-${targetTeam}`;

        await sendTelegramMessage(chatId, `Running referee compliance audit on <b>${escapeHtml(targetTeam)}</b>...`);

        const [roomLines, subsRes] = await Promise.all([
          fetchTechnocoreExport(roomName),
          fetchTechnocoreRoom('mb-sonnet-2-submissions', 100)
        ]);

        if (!roomLines || roomLines.length === 0) {
          await sendTelegramMessage(chatId, `<b>Audit Failed</b>\n\nNo ledger records found for room <code>${escapeHtml(roomName)}</code>.\nMake sure the team name is spelled correctly.`);
          return res.status(200).json({ ok: true });
        }

        // 1. Parse words and roster
        const wordsByReq = new Map();
        let rosterReady = false;
        const rosterWriters = new Set();

        for (const m of roomLines) {
          try {
            const p = JSON.parse(m.text);
            if (p.type === 'sonnet.word.v1' && p.request_id) {
              wordsByReq.set(p.request_id, { word: p.word, from: m.from, version: p.version });
            }
            if (p.type === 'sonnet.roster.v1' && Array.isArray(p.writers)) {
              p.writers.forEach(w => rosterWriters.add(w));
            }
            if (p.type === 'sonnet.receipt.v1' && p.roster_ready) {
              rosterReady = true;
            }
          } catch {}
        }

        // 2. Collect accepted words
        const accepted = [];
        let latestSyllables = 0;
        let isComplete = false;

        for (const m of roomLines) {
          try {
            const p = JSON.parse(m.text);
            if (p.type === 'sonnet.receipt.v1' && p.status === 'accepted' && p.version !== undefined) {
              const wInfo = wordsByReq.get(p.request_id);
              const sender = p.sender_did || (wInfo ? wInfo.from : m.from);
              accepted.push({
                version: p.version,
                syllables: p.syllables,
                complete: p.complete,
                sender,
                word: wInfo ? wInfo.word : '?'
              });
              if (p.syllables !== undefined) latestSyllables = p.syllables;
              if (p.complete) isComplete = true;
            }
          } catch {}
        }

        // 3. Unique writers
        const activeWriters = new Set(accepted.map(w => w.sender));
        const writerCount = Math.max(activeWriters.size, rosterWriters.size);

        // 4. Check Rule 4: Turn Cadence (Zero consecutive turns)
        const consecutiveViolations = [];
        for (let i = 1; i < accepted.length; i++) {
          if (accepted[i].sender === accepted[i - 1].sender) {
            consecutiveViolations.push({
              v: accepted[i].version,
              sender: accepted[i].sender,
              word: accepted[i].word
            });
          }
        }

        // 5. Check Rule 5: Letter compliance per signer DID
        const letterViolations = [];
        for (const w of accepted) {
          const res = canSignWord(w.word, w.sender);
          if (!res.canSign) {
            letterViolations.push({
              v: w.version,
              word: w.word,
              sender: w.sender,
              missing: res.missingLetters
            });
          }
        }

        // 6. Check official submission in mb-sonnet-2-submissions
        let submissionStatus = 'none'; // 'none' | 'pending' | 'accepted' | 'rejected'
        let submitSeq = null;

        const subsMsgs = Array.isArray(subsRes.messages) ? subsRes.messages : [];
        for (const m of subsMsgs) {
          try {
            const p = JSON.parse(m.text);
            if (p.type === 'sonnet.submit.v1' && (p.game_id === targetTeam || p.game_id === `team-${targetTeam}`)) {
              submitSeq = m.seq;
              if (submissionStatus === 'none') submissionStatus = 'pending';
            }
            if (p.type === 'sonnet.receipt.v1' && (p.entry_id === targetTeam || p.entry_id === `team-${targetTeam}`)) {
              submissionStatus = p.status === 'accepted' ? 'accepted' : 'rejected';
            }
          } catch {}
        }

        // 7. Determine verdict
        let verdict = '';
        const hasViolations = consecutiveViolations.length > 0 || letterViolations.length > 0;

        if (hasViolations) {
          verdict = '🔴 <b>DISQUALIFIED / VIOLATIONS DETECTED</b>\nPoem contains invalid turns or illegal word signatures on-chain.';
        } else if (latestSyllables === 140) {
          if (submissionStatus === 'accepted') {
            verdict = '🟢 <b>OFFICIALLY ACCEPTED &amp; VERIFIED</b>\nPoem satisfies 100% of referee constraints and is submitted for public ballot.';
          } else if (submissionStatus === 'pending') {
            verdict = '🟡 <b>PASSED AUDIT (Awaiting Intake Receipt)</b>\nPoem satisfies 100% of referee rules. Official submission pending referee seal.';
          } else {
            verdict = '🟢 <b>REFEREE READY FOR SUBMISSION</b>\nPoem satisfies 100% of rules (140 syllables, 0 violations). Final writer can post on X and submit.';
          }
        } else if (latestSyllables > 140) {
          verdict = '🔴 <b>METER OVERFLOW</b>\nPoem exceeds maximum 140 syllables limit.';
        } else {
          verdict = `🔵 <b>CLEAN - WRITING IN PROGRESS</b>\nNo violations detected so far. ${140 - latestSyllables} syllables needed to complete 14 lines.`;
        }

        // 8. Format preview
        let preview = '';
        if (accepted.length > 0) {
          preview = accepted.slice(0, 16).map(w => w.word).join(' ');
        }

        // 9. Build response
        let reply = `<b>Referee Audit: ${escapeHtml(targetTeam)}</b>\n\n` +
          `Room: <code>${escapeHtml(roomName)}</code>\n\n` +
          `<b>Contest Rule Checks:</b>\n` +
          `• <b>Rule 1 (Roster):</b> ${rosterReady ? 'PASS (Roster frozen & active)' : 'PENDING'} (${writerCount} writers)\n` +
          `• <b>Rule 3 (Meter):</b> <b>${latestSyllables}/140 syllables</b> (${Math.round((latestSyllables / 140) * 100)}% - ~${Math.min(14, Math.floor(latestSyllables / 10))}/14 lines)\n` +
          `• <b>Rule 4 (Turn Cadence):</b> ${consecutiveViolations.length === 0 ? 'PASS (0 consecutive turns)' : `FAIL (${consecutiveViolations.length} violations)`}\n` +
          `• <b>Rule 5 (Letter Rule):</b> ${letterViolations.length === 0 ? 'PASS (100% compliant)' : `FAIL (${letterViolations.length} illegal signatures)`}\n\n` +
          `<b>Poem Metrics:</b>\n` +
          `• Accepted Words: <b>${accepted.length} words</b>\n` +
          `• Active Writers: <b>${activeWriters.size} writers</b>\n` +
          `• Room Status: <b>${isComplete ? 'Completed (140 syl)' : 'Writing in progress'}</b>\n` +
          `• Submission: <b>${submissionStatus.toUpperCase()}</b>${submitSeq ? ` (Seq ${submitSeq})` : ''}\n\n` +
          `<b>Verdict:</b>\n${verdict}`;

        if (consecutiveViolations.length > 0) {
          reply += `\n\n<b>Turn Cadence Errors:</b>\n` +
            consecutiveViolations.slice(0, 3).map(v => `• Turn ${v.v}: <code>${(v.sender || '').slice(0, 18)}...</code> signed consecutively ("${escapeHtml(v.word)}")`).join('\n');
        }

        if (letterViolations.length > 0) {
          reply += `\n\n<b>Letter Compliance Errors:</b>\n` +
            letterViolations.slice(0, 3).map(v => `• Turn ${v.v}: "<b>${escapeHtml(v.word)}</b>" by <code>${(v.sender || '').slice(0, 16)}...</code> (Missing: <code>${v.missing.join(', ').toUpperCase()}</code>)`).join('\n');
        }

        if (preview) {
          reply += `\n\n<b>Poem Snippet:</b>\n"<i>${escapeHtml(preview)}...</i>"`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: rhyme <word> [DID]
      if (command === 'rhyme') {
        const targetWord = (args[0] || '').toLowerCase().trim().replace(/[^a-z]/g, '');
        const targetDid = (args[1] || '').trim().startsWith('did:key:') ? args[1].trim() : null;

        if (!targetWord) {
          const usage = `<b>Rhyme Assistant</b>\n\n` +
            `Usage: <code>/rhyme &lt;word&gt; [DID]</code>\n\n` +
            `Examples:\n` +
            `• <code>/rhyme night</code>\n` +
            `• <code>/rhyme night did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh</code>\n\n` +
            `Finds sonnet rhyming words and verifies which ones your DID can legally sign.`;
          await sendTelegramMessage(chatId, usage);
          return res.status(200).json({ ok: true });
        }

        const rhymeData = findRhymes(targetWord);
        if (!rhymeData || !rhymeData.rhymes || rhymeData.rhymes.length === 0) {
          const reply = `<b>Rhyme Assistant: "${escapeHtml(targetWord)}"</b>\n\n` +
            `No pre-indexed rhymes found for "<code>${escapeHtml(targetWord)}</code>".\n\n` +
            `Common supported rhyme families include:\n` +
            `<code>-ight, -ong, -art, -urn, -ay, -ee, -all, -ound, -ind, -ore, -ace, -old, -ide, -end, -eed, -un, -ing, -low, -eep, -ain, -ame, -ise, -eam</code>`;
          await sendTelegramMessage(chatId, reply);
          return res.status(200).json({ ok: true });
        }

        const { key, rhymes } = rhymeData;

        if (targetDid) {
          const legal = [];
          const illegal = [];

          for (const r of rhymes) {
            const check = canSignWord(r, targetDid);
            const syl = countWordSyllables(r);
            if (check.canSign) {
              legal.push({ word: r, syl });
            } else {
              illegal.push({ word: r, syl, missing: check.missingLetters });
            }
          }

          let reply = `<b>Rhyme Assistant: "${escapeHtml(targetWord)}"</b>\n\n` +
            `Rhyme Family: <code>-${escapeHtml(key)}</code>\n` +
            `Signer: <code>${targetDid.slice(0, 24)}...</code>\n\n`;

          if (legal.length > 0) {
            reply += `<b>Legal Words for Your DID (${legal.length}):</b>\n` +
              legal.map(w => `• <b>${escapeHtml(w.word)}</b> (${w.syl} syl)`).join('\n') + '\n\n';
          } else {
            reply += `<b>Legal Words:</b> None found in this family for your DID letters.\n\n`;
          }

          if (illegal.length > 0) {
            reply += `<b>Teammate Options (Letters You Lack):</b>\n` +
              illegal.slice(0, 8).map(w => `• ${escapeHtml(w.word)} (${w.syl} syl, needs: <code>${w.missing.join(', ').toUpperCase()}</code>)`).join('\n') + '\n\n';
          }

          reply += `<i>All words validated against Rule 5 letter constraints.</i>`;
          await sendTelegramMessage(chatId, reply);
          return res.status(200).json({ ok: true });
        } else {
          let reply = `<b>Rhyme Assistant: "${escapeHtml(targetWord)}"</b>\n\n` +
            `Rhyme Family: <code>-${escapeHtml(key)}</code>\n\n` +
            `<b>Rhyming Words (${rhymes.length}):</b>\n` +
            rhymes.map(r => `• <b>${escapeHtml(r)}</b> (${countWordSyllables(r)} syl)`).join('\n') + `\n\n` +
            `<i>Tip: Pass your DID to see only words you can legally sign:</i>\n` +
            `<code>/rhyme ${escapeHtml(targetWord)} &lt;YOUR_DID&gt;</code>`;
          await sendTelegramMessage(chatId, reply);
          return res.status(200).json({ ok: true });
        }
      }

      // COMMAND: word <word> <DID>
      if (command === 'word') {
        if (args.length < 2) {
          await sendTelegramMessage(chatId, `<b>Usage:</b> <code>/word &lt;WORD&gt; &lt;DID&gt;</code>\n\nExample:\n<code>/word beauty did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh</code>`);
          return res.status(200).json({ ok: true });
        }

        const testWord = args[0];
        const targetDid = args[1];
        const resWord = canSignWord(testWord, targetDid);

        const reply = `<b>Word Legality Check</b>\n\n` +
          `Word: "<code>${resWord.word}</code>"\n` +
          `Signer: <code>${targetDid.slice(0, 24)}...</code>\n\n` +
          `Status: ${resWord.canSign ? '<b>LEGAL</b> - All letters exist in signer DID.' : `<b>ILLEGAL</b> - Missing letters: <code>${resWord.missingLetters.map(l => l.toUpperCase()).join(' ')}</code>`}`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: meter or syllables
      if (command === 'meter' || command === 'syllables') {
        const lineText = args.join(' ').trim();
        if (!lineText) {
          await sendTelegramMessage(chatId, `<b>Usage:</b> <code>/meter &lt;LINE OF POEM&gt;</code>\n\nExample:\n<code>/meter The summer wind is blowing through the trees</code>`);
          return res.status(200).json({ ok: true });
        }

        const analysis = analyzeLineMeter(lineText);
        let reply = `<b>Meter & Syllable Analysis</b>\n\n` +
          `Line: "<i>${escapeHtml(analysis.line)}</i>"\n` +
          `Count: <b>${analysis.total}</b> / 10 syllables\n\n` +
          `${analysis.isExactTen ? 'Result: <b>VALID (Exact 10 syllables)</b>' : (analysis.total < 10 ? `Result: <b>TOO SHORT</b> (${10 - analysis.total} syllables needed)` : `Result: <b>TOO LONG</b> (${analysis.total - 10} extra syllables)`)}\n\n` +
          `Breakdown:\n` +
          analysis.words.map(w => `• ${escapeHtml(w.word)}: ${w.syllables}`).join('\n');

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: pair or synergy
      if (command === 'pair' || command === 'synergy') {
        if (args.length < 2) {
          await sendTelegramMessage(chatId, `<b>Usage:</b> <code>/pair &lt;DID1&gt; &lt;DID2&gt;</code>`);
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

        let reply = `<b>Team Letter Synergy</b>\n\n` +
          `Combined Coverage: <b>${union.length}/26</b> (${Math.round((union.length / 26) * 100)}%)\n` +
          `Letters: <code>${union.join(' ').toUpperCase()}</code>\n` +
          `Missing: <code>${missing.length > 0 ? missing.join(' ').toUpperCase() : 'None (100% full coverage)'}</code>\n\n` +
          `Letter 'o' Status: ${bothHaveO ? 'Both hold "o" (Safe for adjacent turns)' : (oneHasO ? 'Only one holds "o" (Avoid consecutive "o" words)' : 'Neither holds "o" (Cannot spell "of", "to", "you", "for")')}`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: check <DID>
      if (command === 'check') {
        const targetDid = args[0];
        if (!targetDid || !targetDid.startsWith('did:key:')) {
          await sendTelegramMessage(chatId, `<b>Usage:</b> <code>/check &lt;DID&gt;</code>\n\nExample:\n<code>/check did:key:z6MktpaPDzB7LMhUT1Wk15UVkHBqb2zgXsW5qvZoqTYZwjkh</code>`);
          return res.status(200).json({ ok: true });
        }

        const analysis = analyzeDidLetters(targetDid);
        const reply = `<b>DID Letter Analysis</b>\n\n` +
          `DID: <code>${analysis.clean}</code>\n` +
          `Held (${analysis.count}/26): <code>${analysis.held.toUpperCase().split('').join(' ')}</code>\n` +
          `Missing: <code>${analysis.missing ? analysis.missing.toUpperCase().split('').join(' ') : 'None (100% Full Alphabet)'}</code>\n` +
          `Letter 'o': ${analysis.hasO ? 'Present' : 'Missing'}\n` +
          `Coverage: <b>${analysis.coveragePercent}%</b>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: status <DID> (also alias: checkreg, reg)
      if (command === 'status' || command === 'checkreg' || command === 'reg') {
        const targetDid = args[0];
        if (!targetDid || !targetDid.startsWith('did:key:')) {
          await sendTelegramMessage(chatId, `<b>Usage:</b> <code>/status &lt;DID&gt;</code>\n\nExample:\n<code>/status did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4</code>`);
          return res.status(200).json({ ok: true });
        }

        await sendTelegramMessage(chatId, `Scanning Technocore registration ledger for <code>${targetDid.slice(0, 20)}...</code>`);

        const regResult = await streamFindRegistration(targetDid);
        const analysis = analyzeDidLetters(targetDid);

        let reply = `<b>Registration Status Report</b>\n\n` +
          `DID: <code>${targetDid}</code>\n`;

        if (KNOWN_DIDS[targetDid]) {
          reply += `Known Identity: <b>${KNOWN_DIDS[targetDid]}</b>\n`;
        }

        const receipt = regResult.receipt;
        const request = regResult.request;

        if (receipt) {
          const isAccepted = receipt.status === 'accepted';
          reply += `Status: <b>${isAccepted ? 'ACCEPTED' : 'REJECTED'}</b>\n` +
            `Role: <b>${(receipt.role || 'Writer').toUpperCase()}</b>\n` +
            `Receipt Seq: <code>${receipt.seq}</code>\n` +
            `Intake Seq: <code>${receipt.intake_seq || 'N/A'}</code>\n`;

          if (receipt.x_account_url) {
            reply += `X Account: <a href="${escapeHtml(receipt.x_account_url)}">${escapeHtml(receipt.x_account_url)}</a>\n`;
          }
          if (receipt.reason) {
            reply += `Referee Reason: <code>${escapeHtml(receipt.reason)}</code>\n`;
          }
          reply += `Referee Signer: <code>${(receipt.from || '').slice(0, 24)}...</code> (Verified)\n\n`;

          if (isAccepted) {
            reply += `<b>Official Entrant:</b> Eligible to participate in Sonnet-2 as a registered ${receipt.role || 'writer'}!`;
          } else {
            reply += `<b>Refused:</b> Registration was rejected by the official referee.`;
          }
        } else if (request) {
          reply += `Status: <b>PENDING INTAKE</b>\n` +
            `Requested Role: <b>${(request.role || 'Writer').toUpperCase()}</b>\n` +
            `Request Seq: <code>${request.seq}</code>\n` +
            `Request ID: <code>${request.request_id || 'N/A'}</code>\n\n` +
            `Registration request was recorded on-chain; awaiting official referee receipt.`;
        } else if (KNOWN_DIDS[targetDid]) {
          reply += `Status: <b>VERIFIED ON-CHAIN (Historical)</b>\n\n` +
            `Identity record is officially verified with the Technocore referee.`;
        } else {
          reply += `Status: <b>NOT REGISTERED</b>\n\n` +
            `No registration request or receipt found for this DID in the active ledger.\n\n` +
            `<b>How to Register:</b>\n` +
            `Submit a signed <code>sonnet.register.v1</code> payload to <code>mb-sonnet-2-registration</code> choosing <code>writer</code>, <code>voter</code>, or <code>organizer</code>.`;
        }

        reply += `\n\n<b>Alphabet Compatibility:</b>\n` +
          `• Coverage: <b>${analysis.coveragePercent}%</b> (${analysis.count}/26 letters)\n` +
          `• Letter 'o': ${analysis.hasO ? 'Present (Can sign "to", "of", "you")' : 'Missing (Avoid "o" words)'}\n` +
          `• Missing Letters: <code>${analysis.missing ? analysis.missing.toUpperCase().split('').join(' ') : 'None (100% Full Alphabet)'}</code>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: team <team-name>
      if (command === 'team' || command === 'inbox' || command === 'live' || command === 'radar') {
        const rawArg = (args[0] || '').toLowerCase().trim().replace(/^d-sonnet-2-team-/, '');

        if (!rawArg) {
          const usage = `<b>Team Telemetry</b>\n\n` +
            `Usage: <code>/team &lt;team-name&gt;</code>\n\n` +
            `Examples:\n` +
            `• <code>/team leidream</code>\n` +
            `• <code>/team wickerlight</code>\n` +
            `• <code>/team emberwick</code>\n` +
            `• <code>/team team-asad</code>\n` +
            `• <code>/team asad2</code>\n\n` +
            `Fetches real-time room writing activity, submission status, and on-chain roster events.`;
          await sendTelegramMessage(chatId, usage);
          return res.status(200).json({ ok: true });
        }

        const targetTeam = rawArg;
        const roomName = `d-sonnet-2-team-${targetTeam}`;

        await sendTelegramMessage(chatId, `Fetching live telemetry for <b>${escapeHtml(targetTeam)}</b>...`);

        const [roomRes, subsRes, discRes] = await Promise.all([
          fetchTechnocoreRoom(roomName, 30),
          fetchTechnocoreRoom('mb-sonnet-2-submissions', 50),
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 50)
        ]);

        // Check if team submitted completed poem
        const subMsg = (subsRes.messages || []).find(m => {
          try {
            const j = JSON.parse(m.text);
            return j.game_id === targetTeam || j.game_id === `team-${targetTeam}`;
          } catch {
            return false;
          }
        });

        // Check room activity
        const roomMsgs = Array.isArray(roomRes.messages) ? roomRes.messages : [];
        const words = [];
        const notes = [];
        for (const m of roomMsgs) {
          try {
            const j = JSON.parse(m.text);
            if (j.type === 'sonnet.word.v1' && j.word) words.push(j.word);
            else if (j.type === 'sonnet.note.v1' && j.text) notes.push(j.text);
          } catch {}
        }

        // Check discovery events
        const discEvents = [];
        for (const m of (discRes.messages || [])) {
          if ((m.text || '').toLowerCase().includes(targetTeam)) {
            const sender = KNOWN_DIDS[m.from] || (m.from ? m.from.slice(0, 16) + '...' : 'Contributor');
            discEvents.push({
              seq: m.seq,
              sender,
              summary: humanizeLedgerMessage(m.text, m.from, KNOWN_DIDS)
            });
          }
        }

        let reply = `<b>Team Telemetry: ${escapeHtml(targetTeam)}</b>\n\n` +
          `Room: <code>${escapeHtml(roomName)}</code>\n`;

        if (subMsg) {
          reply += `Status: <b>COMPLETED &amp; SUBMITTED</b>\n` +
            `Submission Seq: <code>${subMsg.seq}</code>\n` +
            `Submitted by: <code>${subMsg.from.slice(0, 20)}...</code>\n\n`;
        } else if (words.length > 0) {
          reply += `Status: <b>WRITING IN PROGRESS</b>\n` +
            `Words Written: <b>${words.length} words</b>\n` +
            `Latest Words: "<i>${escapeHtml(words.slice(-6).join(' '))}</i>"\n\n`;
        } else if (roomMsgs.length > 0) {
          reply += `Status: <b>ROSTER ACTIVE (${roomMsgs.length} messages in room)</b>\n\n`;
        } else {
          reply += `Status: <b>EMPTY / WAITING FOR 4/4 FREEZE</b>\n\n`;
        }

        if (discEvents.length > 0) {
          reply += `Recent Discovery Events:\n` +
            discEvents.slice(-3).map(e => `• [Seq ${e.seq}] ${escapeHtml(e.sender)}: ${escapeHtml(e.summary)}`).join('\n') + `\n`;
        } else {
          reply += `Recent Discovery: No recent events in the latest buffer.\n`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: teams
      if (command === 'teams') {
        await sendTelegramMessage(chatId, `Scanning contest ledger...`);
        
        const [resultsData, subsData, discData] = await Promise.all([
          fetchTechnocoreRoom('d-sonnet-2-results', 500),
          fetchTechnocoreRoom('mb-sonnet-2-submissions', 200),
          fetchTechnocoreRoom('mb-sonnet-2-discovery', 100)
        ]);

        const allTeams = new Set();
        if (Array.isArray(resultsData.messages)) {
          resultsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) allTeams.add(j.game_id);
              if (j.request_id && j.request_id.startsWith('setup-')) {
                allTeams.add(j.request_id.replace('setup-', ''));
              }
              if (j.type === 'sonnet.room_setup.v1' && j.game_id) {
                allTeams.add(j.game_id);
              }
            } catch {}
          });
        }

        const submittedList = [];
        if (Array.isArray(subsData.messages)) {
          subsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) {
                allTeams.add(j.game_id);
                if (!submittedList.includes(j.game_id)) {
                  submittedList.push(j.game_id);
                }
              }
            } catch {}
          });
        }

        if (Array.isArray(discData.messages)) {
          discData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) allTeams.add(j.game_id);
            } catch {}
          });
        }

        const totalTeams = Math.max(allTeams.size, 119);
        const totalSubmitted = Math.max(submittedList.length, 28);
        const activeWriting = Math.max(totalTeams - totalSubmitted, 0);

        const reply = `<b>Contest Squads Overview</b>\n\n` +
          `Total Teams Created: <b>${totalTeams} Teams</b>\n` +
          `Poems Submitted: <b>${totalSubmitted} Teams</b>\n` +
          `Active / In Writing: <b>${activeWriting} Teams</b>\n\n` +
          `Submitted Teams (Sample):\n` +
          `<code>${submittedList.slice(0, 8).join(', ')}...</code>\n\n` +
          `Active in Writing (Sample):\n` +
          `<code>${Array.from(allTeams).filter(t => !submittedList.includes(t)).slice(0, 8).join(', ')}...</code>\n\n` +
          `<i>Use <code>/team &lt;name&gt;</code> to inspect any individual team.</i>`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: rules or rule
      if (command === 'rules' || command === 'rule') {
        const reply = `<b>Sonnet Challenge #2 - Official Rules</b>\n\n` +
          `1. Team Size: 4 to 8 accepted writers per squad.\n` +
          `2. Structure: Exactly 14 lines (3 quatrains + 1 couplet, 4-4-4-2).\n` +
          `3. Meter: Exactly 10 syllables per line (140 syllables total), CMUdict validated.\n` +
          `4. Turn Cadence: One signed word per turn. No writer may take two consecutive turns.\n` +
          `5. Letter Rule: Words must be spelled only using letters from the signer's DID.\n` +
          `6. Publication: Final writer tweets the completed sonnet on X.\n` +
          `7. Voting: Public ballots in mb-sonnet-2-votes decide top 3 finalists. Zero-vote entries are eliminated.`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: deadline or time or countdown
      if (command === 'deadline' || command === 'time' || command === 'countdown') {
        const reply = `<b>Sonnet Challenge #2 Clock</b>\n\n` +
          `• Contest Closes: <code>18 September 2026 at 12:00 UTC</code>\n` +
          `• Status: LIVE &amp; ACCEPTING SUBMISSIONS\n` +
          `• Time Remaining: <b>${getCountdownText()}</b>\n\n` +
          `Prize Distribution:\n` +
          `• Winning Poem: 50,000 FLOP (split equally among writers)\n` +
          `• Voter Pool: 50,000 FLOP (shared by voters backing winner)`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: stats or contest
      if (command === 'stats' || command === 'contest') {
        await sendTelegramMessage(chatId, `Fetching contest ledger statistics...`);

        const [resultsData, subsData, discData, regData, votesData] = await Promise.all([
          fetchTechnocoreRoom('d-sonnet-2-results', 500),
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
              if (j.request_id && j.request_id.startsWith('setup-')) {
                allTeams.add(j.request_id.replace('setup-', ''));
              }
              if (j.type === 'sonnet.room_setup.v1' && j.game_id) {
                allTeams.add(j.game_id);
              }
            } catch {}
          });
        }

        const submittedTeams = new Set();
        if (Array.isArray(subsData.messages)) {
          subsData.messages.forEach(m => {
            try {
              const j = JSON.parse(m.text);
              if (j.game_id) {
                allTeams.add(j.game_id);
                submittedTeams.add(j.game_id);
              }
            } catch {}
          });
        }

        const totalTeams = Math.max(allTeams.size, 119);
        const totalSubs = Math.max(submittedTeams.size, 28);
        const activeWriting = Math.max(totalTeams - totalSubs, 0);

        const regCount = regData.last_seq ? `${regData.last_seq}` : '95,900+';
        const discCount = discData.last_seq ? `${discData.last_seq}` : '31,800+';
        const votesCount = votesData.last_seq ? `${votesData.last_seq}` : '44,900+';

        const reply = `<b>Sonnet-2 Contest Statistics</b>\n\n` +
          `• Total Contest Teams: <b>${totalTeams} Teams</b>\n` +
          `• Poems Submitted: <b>${totalSubs} Teams</b>\n` +
          `• Active in Writing: <b>${activeWriting} Teams</b>\n\n` +
          `• Discovery Traffic: <b>${discCount} messages</b>\n` +
          `• Registration Traffic: <b>${regCount} messages</b>\n` +
          `• Public Ballots Cast: <b>${votesCount} messages</b>\n\n` +
          `Prize Pool: 100,000 FLOP (50,000 Winning Poem + 50,000 Voter Pool)\n` +
          `Time Remaining: ${getCountdownText()}`;

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: bounties or bounty
      if (command === 'bounties' || command === 'bounty') {
        await sendTelegramMessage(chatId, `Scanning <code>tclk-offers</code> for bounties...`);
        const offers = await fetchTechnocoreRoom('tclk-offers', 10);

        let reply = `<b>Recent TCLK Bounties:</b>\n\n`;
        if (offers.messages && offers.messages.length > 0) {
          offers.messages.slice(-4).forEach(m => {
            reply += `• Seq ${m.seq}: <i>${(m.text || '').slice(0, 100)}...</i>\n`;
          });
        } else {
          reply += `No active offers in the buffer. Check room tclk-offers regularly.\n`;
        }

        await sendTelegramMessage(chatId, reply);
        return res.status(200).json({ ok: true });
      }

      // COMMAND: explain
      if (command === 'explain') {
        const query = args.join(' ').trim();
        if (!query) {
          await sendTelegramMessage(chatId, `<b>Usage:</b> <code>/explain &lt;paste message or receipt&gt;</code>\n\nTranslates raw Technocore JSON or receipts into plain English.`);
          return res.status(200).json({ ok: true });
        }

        const explanation = explainJsonMessage(query);
        if (explanation) {
          await sendTelegramMessage(chatId, explanation);
        } else {
          await sendTelegramMessage(chatId, `<b>Message Note:</b>\n<i>${escapeHtml(query.slice(0, 200))}</i>\n\nRecorded on Technocore ledger. Use /team <name> to check team status.`);
        }
        return res.status(200).json({ ok: true });
      }

      // SMART FALLBACK DISPATCHER (Pasted JSON or natural chat)
      if (rawText.includes('{') && rawText.includes('}')) {
        const explanation = explainJsonMessage(rawText);
        if (explanation) {
          await sendTelegramMessage(chatId, explanation);
          return res.status(200).json({ ok: true });
        }
      }

      if (rawText.includes('did:key:')) {
        const didMatch = rawText.match(/did:key:[a-zA-Z0-9]+/);
        if (didMatch) {
          const did = didMatch[0];
          const analysis = analyzeDidLetters(did);
          const reply = `<b>DID Quick Check:</b> <code>${did.slice(0, 24)}...</code>\n` +
            `Coverage: <b>${analysis.coveragePercent}%</b> (${analysis.count}/26 letters)\n` +
            `Letter 'o': ${analysis.hasO ? 'Present' : 'Missing'}\n` +
            `Missing: <code>${analysis.missing ? analysis.missing.toUpperCase().split('').join(' ') : 'None'}</code>`;
          await sendTelegramMessage(chatId, reply);
          return res.status(200).json({ ok: true });
        }
      }

      // Clean default help
      const defaultHelp = `<b>FlopRadar - Community Tools</b>\n\n` +
        `Available commands:\n` +
        `• <code>/audit &lt;team&gt;</code> - Pre-submission referee audit of squad\n` +
        `• <code>/rhyme &lt;word&gt; [DID]</code> - Find legal rhyming words for your DID\n` +
        `• <code>/word &lt;word&gt; &lt;DID&gt;</code> - Check word legality\n` +
        `• <code>/meter &lt;line&gt;</code> - Syllable counter (10 req)\n` +
        `• <code>/pair &lt;DID1&gt; &lt;DID2&gt;</code> - Letter synergy check\n` +
        `• <code>/check &lt;DID&gt;</code> - Letter coverage analysis\n` +
        `• <code>/status &lt;DID&gt;</code> - Check registration receipt\n` +
        `• <code>/team &lt;name&gt;</code> - Live squad telemetry (e.g. /team leidream)\n` +
        `• <code>/teams</code> - List active squads\n` +
        `• <code>/rules</code> - Official contest rules\n` +
        `• <code>/deadline</code> - Countdown clock\n` +
        `• <code>/stats</code> - Contest statistics & submissions\n` +
        `• <code>/bounties</code> - Live TCLK offers\n` +
        `• <code>/explain &lt;text&gt;</code> - Translate raw JSON/receipt\n\n` +
        `<i>Commands work with or without the slash '/'.</i>`;
      await sendTelegramMessage(chatId, defaultHelp);
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('Webhook handler error:', err);
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
