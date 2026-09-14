/**
 * Technocore TCLK Bounty Hunter & Auto-Solver Engine
 * Private & Exclusive to: Asad Lee (did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4)
 *
 * Real-time zero-latency offer scanner, automated problem solver,
 * and cryptographic state-machine executor for the Technocore protocol.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
if (typeof self === 'undefined') globalThis.self = globalThis;
require('./vendor/nacl-fast.min.js');
const nacl = globalThis.nacl;

import { restoreKeypair, parseDidKey, signMessage } from './crypto.js';
import { dispatchSignedMessage, fetchProtocol } from './transport.js';
import { globalNonceManager } from './nonce.js';
import { computeContractId, dealRoomName, stateNotePath, paperNotePath, ensureDidNotePublished } from './sniper.mjs';

// Target Authorized Identity
export const AUTHORIZED_DID = 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';
const SECRETS_FILE = path.resolve(process.cwd(), 'solver_secrets.json');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8814701073:AAF2gj_wL-37JyJoqA_2vTDSdPN5NwFKXI0';

// Stats tracker
const stats = {
  scannedOffers: 0,
  solvedTasks: 0,
  earnedFlop: 0,
  earnedPaper: 0,
  receipts: 0,
  startTime: Date.now()
};

async function sendTelegramAlert(text) {
  try {
    let chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      try {
        const res = await fetch('https://technocore.chat/kv/flopradar-alerts/chat_id');
        const txt = await res.text();
        const m = txt.match(/\b([0-9]{7,12})\b/);
        if (m) chatId = m[1];
      } catch {}
    }
    if (!chatId) return;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    console.warn('[Telegram Alert Failed]:', err.message);
  }
}

/**
 * Load or prompt for the private secret key / seed
 */
async function loadOrPromptCredentials() {
  let secretInput = process.env.SOLVER_SEED || process.env.TECHNOCORE_SEED || null;

  if (!secretInput && fs.existsSync(SECRETS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
      if (data.secretKeyOrSeed && !data.secretKeyOrSeed.includes('PASTE_YOUR')) {
        secretInput = data.secretKeyOrSeed.trim();
      }
    } catch (e) {
      console.warn('⚠️ Could not parse solver_secrets.json:', e.message);
    }
  }

  if (!secretInput) {
    console.log('\n=============================================================');
    console.log('⚡ TECHNOCORE PRIVATE TCLK BOUNTY HUNTER (ASAD LEE)');
    console.log('=============================================================');
    console.log(`Target DID: ${AUTHORIZED_DID}`);
    console.log('\n🔒 Private Key Authentication Required:');
    console.log('Please enter your 32-byte seed (hex/base64) or 64-byte secret key:');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    secretInput = await new Promise(resolve => {
      rl.question('> ', answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!secretInput) {
    throw new Error('No secret key or seed provided. Exiting.');
  }

  let kp;
  try {
    kp = restoreKeypair(secretInput, nacl);
  } catch (err) {
    throw new Error(`Failed to restore keypair: ${err.message}`);
  }

  if (kp.did !== AUTHORIZED_DID) {
    console.error(`\n❌ ERROR: Key mismatch!`);
    console.error(`Expected DID: ${AUTHORIZED_DID}`);
    console.error(`Derived DID:  ${kp.did}`);
    throw new Error('This solver is strictly private to Asad Lee (did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4).');
  }

  // Save to solver_secrets.json (which is gitignored)
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify({
      did: AUTHORIZED_DID,
      secretKeyOrSeed: secretInput,
      savedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (err) {
    // Ignore if write restricted
  }

  console.log(`\n✅ Identity Verified: ${kp.did}`);
  return kp;
}

/**
 * Task Knowledge Base & Automated Solvers
 */
async function solveTask(jobContext, specText = '') {
  const fullText = `${jobContext || ''}\n${specText || ''}`;

  // 1. OpenAPI Pattern for did:key
  if (/exact pattern for a valid did:key identifier/i.test(fullText)) {
    return {
      deliverable: '^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$',
      type: 'exact-phrase',
      confidence: 1.0
    };
  }

  // 2. Protocol Maximum Message Length
  if (/maximum character length for a message in this protocol/i.test(fullText)) {
    return {
      deliverable: '4096',
      type: 'exact-phrase',
      confidence: 1.0
    };
  }

  // 3. TCLK Frame Flow - Payee response after offer
  if (/What frame does the payee send after receiving an offer/i.test(fullText)) {
    return {
      deliverable: 'accept',
      type: 'exact-phrase',
      confidence: 1.0
    };
  }

  // 4. Nonce Replay HTTP Status Code
  if (/Nonce replay on the signed lane[\s\S]*Report the HTTP status of the second req/i.test(fullText)) {
    return {
      deliverable: '400',
      type: 'exact-status',
      confidence: 1.0
    };
  }

  // 5. Single Word Challenge (e.g. "Reply with the single word: setuju")
  const singleWordMatch = fullText.match(/Reply with the single word:\s*([A-Za-z0-9_-]+)/i);
  if (singleWordMatch) {
    return {
      deliverable: singleWordMatch[1],
      type: 'single-word',
      confidence: 1.0
    };
  }

  // 6. Matrix & Table Inference Questions
  // Parse rows: seq | payer | amount | asset | proto | time
  const rowRegex = /(\d+)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(\d+)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(\d\d:\d\d:\d\d)/g;
  const rows = [];
  let m;
  while ((m = rowRegex.exec(fullText)) !== null) {
    rows.push({
      seq: parseInt(m[1], 10),
      payer: m[2],
      amount: parseInt(m[3], 10),
      asset: m[4],
      proto: m[5],
      time: m[6]
    });
  }

  if (rows.length > 0) {
    // 6a. Even seq values ascending
    if (/even numbers[\s\S]*ascending order[\s\S]*comma-separated/i.test(fullText)) {
      const evens = rows.filter(r => r.seq % 2 === 0).map(r => r.seq).sort((a, b) => a - b);
      return {
        deliverable: evens.length ? evens.join(', ') : 'none',
        type: 'matrix-even',
        confidence: 0.95
      };
    }

    // 6b. Earliest and latest time seq
    if (/earliest time and the seq of the row with the latest time/i.test(fullText)) {
      const sorted = [...rows].sort((a, b) => a.time.localeCompare(b.time) || a.seq - b.seq);
      const earliest = sorted[0].seq;
      const latest = sorted[sorted.length - 1].seq;
      return {
        deliverable: `${earliest} ${latest}`,
        type: 'matrix-time',
        confidence: 0.95
      };
    }

    // 6c. Top 3 largest amount
    if (/3 rows with the largest amount[\s\S]*highest first/i.test(fullText)) {
      const sorted = [...rows].sort((a, b) => b.amount - a.amount || a.seq - b.seq);
      const top3 = sorted.slice(0, 3).map(r => r.seq).join(', ');
      return {
        deliverable: top3,
        type: 'matrix-largest',
        confidence: 0.95
      };
    }
  }

  // 7. Lock frame counter question
  // "how many rows are lock frames posted by did:key:z6Mk..."
  const countMatch = fullText.match(/how many rows are lock frames posted by\s*(did:key:z6Mk[A-Za-z0-9_-]+)/i);
  if (countMatch) {
    const targetDid = countMatch[1];
    const lockRegex = new RegExp(`\\b${targetDid}\\b`, 'g');
    const matches = fullText.match(lockRegex);
    const count = matches ? matches.length : 0;
    return {
      deliverable: String(count),
      type: 'count-query',
      confidence: 0.8
    };
  }

  return null;
}

/**
 * Handle a single open offer
 */
async function processOffer(offer, keypair) {
  const offerId = offer.id;
  const payer = offer.from;
  const amount = offer.amount || '0';
  const asset = offer.asset || 'FLOP';
  const context = offer.job?.context || '';

  console.log(`\n🎯 [NEW OFFER DETECTED] Seq: ${offer.seq || 'N/A'} | Reward: ${amount} ${asset} | From: ${payer.slice(0, 16)}...`);
  console.log(`   Task: ${context.slice(0, 120)}...`);

  // If spec points to /kv/, fetch it
  let specText = '';
  const specMatch = context.match(/(?:full spec:|\/kv\/)\s*(\/kv\/[^\s]+|[^\s]+\/kv\/[^\s]+)/);
  if (specMatch) {
    const specUrl = specMatch[1].replace(/^[a-z]+:\/\/[^\/]+/i, '');
    try {
      const res = await fetchProtocol(specUrl);
      if (res.ok && res.text) {
        specText = res.text;
      }
    } catch (e) {
      // Ignore fetch error
    }
  }

  // Solve the task
  const solution = await solveTask(context, specText);
  if (!solution) {
    console.log(`   ⏭️ Task pattern not automatically solvable. Skipping.`);
    return;
  }

  console.log(`   💡 Solved [${solution.type}]: "${solution.deliverable}"`);

  // Mint 32-byte secret preimage & derive HTLC statement
  const preimageBytes = crypto.randomBytes(32);
  const secret = '0x' + preimageBytes.toString('hex');
  const statement = '0x' + crypto.createHash('sha256').update(preimageBytes).digest('hex');
  const acceptNonce = crypto.randomBytes(8).toString('hex');

  const acceptCore = {
    from: keypair.did,
    ref: offerId,
    statement,
    nonce: acceptNonce
  };
  const contract = computeContractId(offer, acceptCore);
  const dealRoom = dealRoomName(contract);
  const { ns: sNs, key: sKey } = stateNotePath(contract);
  const { ns: pNs, key: pKey } = paperNotePath(contract);

  const acceptFrame = {
    type: 'accept',
    from: keypair.did,
    ref: offerId,
    statement,
    contract,
    nonce: acceptNonce
  };

  const acceptText = `tclk1 ${JSON.stringify(acceptFrame)}`;
  console.log(`   📤 Posting canonical accept frame (contract: ${contract.slice(0, 18)}...)...`);

  try {
    const acceptRes = await dispatchSignedMessage(nacl, keypair, 'tclk-offers', acceptText);
    if (!acceptRes.ok && acceptRes.status >= 400) {
      console.log(`   ❌ Accept failed (${acceptRes.status}): ${acceptRes.text?.slice(0, 100)}`);
      return;
    }
    console.log(`   ✅ Accept posted successfully! Derived deal room: ${dealRoom}`);
  } catch (err) {
    console.error(`   ❌ Dispatch error: ${err.message}`);
    return;
  }

  // Deliver solution text to deal room
  try {
    await dispatchSignedMessage(nacl, keypair, dealRoom, solution.deliverable);
    console.log(`   📬 Sent solution deliverable to deal room: ${dealRoom}`);
  } catch (e) {}

  // Wait for lock frame in deal room and public board (up to 30 seconds)
  const lockWaitDeadline = Date.now() + 30000;
  let lockConfirmed = false;
  let lockRailRef = contract;

  while (Date.now() < lockWaitDeadline) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const [drCheck, boardCheck, noteCheck] = await Promise.all([
        fetchProtocol(`r/${dealRoom}?format=json&limit=10`).catch(() => null),
        fetchProtocol('r/tclk-offers?format=json&limit=15').catch(() => null),
        fetchProtocol(`kv/${sNs}/${sKey}`).catch(() => null)
      ]);

      if (noteCheck?.ok && noteCheck.text?.startsWith('locked')) {
        lockConfirmed = true;
        break;
      }

      if (drCheck?.ok && drCheck.json?.messages) {
        for (const msg of drCheck.json.messages) {
          if (msg.text && msg.text.includes('"type":"lock"') && msg.text.includes(contract)) {
            try {
              const parsed = JSON.parse(msg.text.replace(/^tclk1\s+/, ''));
              if (parsed.ref) lockRailRef = parsed.ref;
            } catch {}
            lockConfirmed = true;
            break;
          }
        }
      }
      if (lockConfirmed) break;

      if (boardCheck?.ok && boardCheck.json?.messages) {
        for (const msg of boardCheck.json.messages) {
          if (msg.text && msg.text.includes('"type":"lock"') && msg.text.includes(contract)) {
            try {
              const parsed = JSON.parse(msg.text.replace(/^tclk1\s+/, ''));
              if (parsed.ref) lockRailRef = parsed.ref;
            } catch {}
            lockConfirmed = true;
            break;
          }
        }
      }
      if (lockConfirmed) break;
    } catch (e) {}
  }

  if (!lockConfirmed) {
    console.log(`   ⏳ Payer did not lock within timeout (likely another bot won the race).`);
    return;
  }

  console.log(`   🔒 Lock verified from payer! Fulfilling claim...`);

  // Deliver the secret (reveal)
  const revealFrame = {
    type: 'reveal',
    from: keypair.did,
    contract,
    secret
  };
  const revealText = `tclk1 ${JSON.stringify(revealFrame)}`;

  try {
    await Promise.allSettled([
      dispatchSignedMessage(nacl, keypair, 'tclk-offers', revealText),
      dispatchSignedMessage(nacl, keypair, dealRoom, revealText)
    ]);
    console.log(`   🎉 Reveal posted to public board and deal room!`);

    // Receipt frame
    const receiptFrame = {
      type: 'receipt',
      from: keypair.did,
      contract,
      outcome: 'claimed',
      rail: 'paper',
      ref: lockRailRef
    };
    const receiptText = `tclk1 ${JSON.stringify(receiptFrame)}`;
    dispatchSignedMessage(nacl, keypair, 'tclk-offers', receiptText).catch(() => {});
    dispatchSignedMessage(nacl, keypair, dealRoom, receiptText).catch(() => {});

    // Update CAS state note
    fetchProtocol(`kv/${sNs}/${sKey}/set/claimed`).catch(() => {});
    fetchProtocol(`kv/${pNs}/${pKey}/set/${encodeURIComponent(JSON.stringify({ status: 'claimed', secret }))}`).catch(() => {});
  } catch (e) {}

    // Update stats
    stats.solvedTasks++;
    if (asset === 'FLOP') {
      stats.earnedFlop += parseInt(amount, 10) || 0;
    } else {
      stats.earnedPaper += parseInt(amount, 10) || 0;
    }

    console.log(`   💰 [REWARD CLAIMED] +${amount} ${asset}! Total FLOP: ${stats.earnedFlop}`);

    // Send instant Telegram notification to user
    await sendTelegramAlert(
      `💰 <b>BOUNTY SOLVED &amp; CLAIMED!</b>\n\n` +
      `• <b>Reward:</b> +${amount} ${asset}\n` +
      `• <b>Task:</b> <i>${context.slice(0, 100)}...</i>\n` +
      `• <b>Answer:</b> <code>${solution.deliverable}</code>\n` +
      `• <b>Total FLOP Earned:</b> ${stats.earnedFlop} FLOP\n\n` +
      `<i>Target: Asad Lee (${AUTHORIZED_DID.slice(0, 18)}...)</i>`
    );
  } catch (err) {
    console.error(`   ❌ Reveal dispatch error: ${err.message}`);
  }
}

/**
 * Main continuous long-polling loop
 */
async function startBountyHunter(keypair) {
  console.log('\n=============================================================');
  console.log('🚀 TECHNOCORE TCLK BOUNTY HUNTER ACTIVE (24/7 MODE)');
  console.log(`DID: ${keypair.did}`);
  console.log('Listening for live bounty offers on /r/tclk-offers...');
  console.log('=============================================================\n');

  let lastSeq = null;
  const processedOfferIds = new Set();

  while (true) {
    try {
      const url = lastSeq ? `r/tclk-offers?format=json&since=${lastSeq}&wait=10` : 'r/tclk-offers?format=json&limit=20';
      const res = await fetchProtocol(url);

      if (res.ok && res.json?.messages) {
        const messages = res.json.messages;
        if (res.json.last_seq) {
          lastSeq = res.json.last_seq;
        }

        for (const msg of messages) {
          if (msg.text && msg.text.includes('"type":"offer"')) {
            try {
              const clean = msg.text.replace(/^tclk1\s+/, '');
              const offer = JSON.parse(clean);
              if (offer.id && !processedOfferIds.has(offer.id)) {
                processedOfferIds.add(offer.id);
                stats.scannedOffers++;
                await processOffer({ ...offer, seq: msg.seq }, keypair);
              }
            } catch (e) {
              // Ignore malformed offer
            }
          }
        }
      }
    } catch (err) {
      console.error(`[Poll Error] ${err.message}. Retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }

    // Keep memory clean
    if (processedOfferIds.size > 2000) {
      processedOfferIds.clear();
    }
  }
}

export { solveTask, processOffer, startBountyHunter, loadOrPromptCredentials };

// Entry point only when invoked directly
import url from 'url';
const isMain = process.argv[1] && url.fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  loadOrPromptCredentials()
    .then(kp => startBountyHunter(kp))
    .catch(err => {
      console.error(`\n❌ Fatal: ${err.message}`);
      process.exit(1);
    });
}

