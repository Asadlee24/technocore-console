/**
 * Comprehensive Automated Test Suite for Technocore Console V4
 * Tests all cryptographic functions, protocol normalization, secret shape guard,
 * signed transport shapes, DID registry pathing, and Sonnet Challenge mechanics.
 */

import assert from 'assert';
import {
  encodeBase58,
  decodeBase58,
  encodeBase64Url,
  decodeBase64Url,
  bytesToHex,
  hexToBytes,
  deriveDidKey,
  parseDidKey,
  generateKeypair,
  restoreKeypair,
  signMessage,
  verifyMessageSignature,
  signMemory,
  verifyMemorySignature
} from './crypto.js';
import {
  sweepSingleLine,
  isValidProtocolName,
  sanitizeRoomName,
  buildSignedPayload,
  deriveRegistryPath,
  formatCanonicalPoem,
  computePoemSha256
} from './protocol.js';
import { detectSensitiveContent, wipeBytes, redactSecrets } from './security.js';
import { NonceManager } from './nonce.js';
import { ReceiptEngine } from './receipt.js';
import {
  checkDidLetterCompatibility,
  parseCmudictLexicon,
  countWordSyllables,
  validateCandidateWord,
  validatePoemSyllables,
  buildRegistrationPayload,
  buildTeamRequestPayload,
  buildRosterPayload,
  buildWordProposalPayload,
  buildSubmissionPayload,
  buildBallotPayload,
  buildClaimPayload
} from './sonnet.js';
import { DEFAULT_CONTEST } from './contest-config.js';

// Load tweetnacl for testing in Node.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nacl = require('./vendor/nacl-fast.min.js');

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

console.log('\n========================================');
console.log('TECHNOCORE CONSOLE V4 TEST SUITE');
console.log('========================================\n');

// ----------------------------------------------------
// SECTION 1: Keypair & DID Cryptography
// ----------------------------------------------------
console.log('--- Section 1: Keypair & DID Cryptography ---');

test('Ed25519 key generation produces 32-byte pub, 64-byte priv, and did:key:z6Mk...', () => {
  const kp = generateKeypair(nacl);
  assert.strictEqual(kp.publicKey.length, 32);
  assert.strictEqual(kp.secretKey.length, 64);
  assert.strictEqual(kp.seed.length, 32);
  assert.strictEqual(kp.did.startsWith('did:key:z6Mk'), true);
  assert.strictEqual(kp.did.length, 56);
});

test('32-byte seed restoration and 64-byte secret restoration produce the EXACT SAME did:key', () => {
  const kp = generateKeypair(nacl);
  const seedHex = bytesToHex(kp.seed);
  const secretHex = bytesToHex(kp.secretKey);

  const fromSeed = restoreKeypair(seedHex, nacl);
  const fromSecret = restoreKeypair(secretHex, nacl);

  assert.strictEqual(fromSeed.did, kp.did);
  assert.strictEqual(fromSecret.did, kp.did);
  assert.strictEqual(bytesToHex(fromSeed.publicKey), bytesToHex(fromSecret.publicKey));
});

test('did:key parsing roundtrips to original 32-byte public key', () => {
  const samplePub = new Uint8Array(32);
  samplePub[0] = 0x12;
  samplePub[31] = 0xef;
  const did = deriveDidKey(samplePub);
  const parsed = parseDidKey(did);
  assert.strictEqual(bytesToHex(samplePub), bytesToHex(parsed));
});

test('Base64url canonical signature length is 86 and ends with one of [AQgw]', () => {
  const kp = generateKeypair(nacl);
  const sig = signMessage(nacl, kp.secretKey, 'lobby', 123456, 'test message');
  assert.strictEqual(sig.length, 86);
  assert.strictEqual(!sig.includes('='), true);
  assert.strictEqual(!sig.includes('+'), true);
  assert.strictEqual(!sig.includes('/'), true);
  const lastChar = sig.slice(-1);
  assert.strictEqual(['A', 'Q', 'g', 'w'].includes(lastChar), true);
});

// ----------------------------------------------------
// SECTION 2: Protocol Normalization & Signature Determinism
// ----------------------------------------------------
console.log('\n--- Section 2: Text Sweeping & Signature Determinism ---');

test('Single-line sweep replaces C0/C1, format, surrogates, Zl, Zp and trims whitespace', () => {
  const dirty = "  \t\r\nHello\u200BWorld\u2028Line2\uFEFF  ";
  const swept = sweepSingleLine(dirty);
  assert.strictEqual(swept, 'Hello World Line2');
});

test('Exact signature determinism: same message => valid signature', () => {
  const kp = generateKeypair(nacl);
  const sig = signMessage(nacl, kp.secretKey, 'lobby', '1000', 'hello from agent');
  const check = verifyMessageSignature(nacl, kp.did, sig, 'lobby', '1000', 'hello from agent');
  assert.strictEqual(check.valid, true);
});

test('Signature failure: modified message => invalid signature', () => {
  const kp = generateKeypair(nacl);
  const sig = signMessage(nacl, kp.secretKey, 'lobby', '1000', 'hello from agent');
  const check = verifyMessageSignature(nacl, kp.did, sig, 'lobby', '1000', 'hello from agent altered');
  assert.strictEqual(check.valid, false);
});

test('Signature failure: modified room => invalid signature', () => {
  const kp = generateKeypair(nacl);
  const sig = signMessage(nacl, kp.secretKey, 'lobby', '1000', 'hello from agent');
  const check = verifyMessageSignature(nacl, kp.did, sig, 'other-room', '1000', 'hello from agent');
  assert.strictEqual(check.valid, false);
});

test('Signature failure: modified nonce => invalid signature', () => {
  const kp = generateKeypair(nacl);
  const sig = signMessage(nacl, kp.secretKey, 'lobby', '1000', 'hello from agent');
  const check = verifyMessageSignature(nacl, kp.did, sig, 'lobby', '1001', 'hello from agent');
  assert.strictEqual(check.valid, false);
});

test('Signature validity on JSON protocol payloads', () => {
  const kp = generateKeypair(nacl);
  const payload = JSON.stringify({ type: 'sonnet.register.v1', contest_id: 'sonnet-1', role: 'writer' });
  const sig = signMessage(nacl, kp.secretKey, 'mb-sonnet-1-registration', '5001', payload);
  const check = verifyMessageSignature(nacl, kp.did, sig, 'mb-sonnet-1-registration', '5001', payload);
  assert.strictEqual(check.valid, true);
});

test('Protocol name validation and sanitization', () => {
  assert.strictEqual(isValidProtocolName('lobby'), true);
  assert.strictEqual(isValidProtocolName('mb-sonnet-1-registration'), true);
  assert.strictEqual(isValidProtocolName('d-sonnet-1-team-abc_1'), true);
  assert.strictEqual(isValidProtocolName('Invalid Name!'), false);
  assert.strictEqual(isValidProtocolName(''), false);
  assert.strictEqual(sanitizeRoomName('My Room 123!'), 'my-room-123');
});

// ----------------------------------------------------
// SECTION 3: Secret Shape Guard (Critical Bug Fix)
// ----------------------------------------------------
console.log('\n--- Section 3: Secret Shape Guard (Allow Hashes vs Detect Keys) ---');

test('64-char SHA-256 hash in previous_state_hash is ALLOWED', () => {
  const text = JSON.stringify({
    type: 'sonnet.word.v1',
    previous_state_hash: 'e7ad4be948b9f3aef15d4aad4986c613e858a9faf78138b300bb6df7d14bcb8f',
    word: 'The'
  });
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, false);
});

test('64-char SHA-256 hash in poem_sha256 is ALLOWED', () => {
  const text = JSON.stringify({
    type: 'sonnet.submit.v1',
    poem_sha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
    final_version: 98
  });
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, false);
});

test('Plain text referring to a dictionary SHA-256 hash is ALLOWED', () => {
  const text = 'Verified dictionary sha256 81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22 successfully.';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, false);
});

test('32-byte raw secret credential explicitly labeled is DETECTED and BLOCKED', () => {
  const text = 'my secret_key: e2b0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, true);
  assert.strictEqual(res.reason.includes('credential') || res.reason.includes('secret'), true);
});

test('64-byte Ed25519 secret key (128 hex chars) is DETECTED and BLOCKED', () => {
  const text = 'here is key ' + 'a'.repeat(128) + ' please inspect';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, true);
  assert.strictEqual(res.reason.includes('64-byte secret key'), true);
});

test('PEM private key header block is DETECTED and BLOCKED', () => {
  const text = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, true);
  assert.strictEqual(res.reason.includes('PEM private key'), true);
});

test('12-word recovery seed phrase is DETECTED and BLOCKED', () => {
  const text = 'apple banana cherry dog eagle fox grape horse igloo jungle kangaroo lion';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, true);
  assert.strictEqual(res.reason.includes('12-word recovery seed phrase'), true);
});

test('24-word recovery seed phrase is DETECTED and BLOCKED', () => {
  const text = 'apple banana cherry dog eagle fox grape horse igloo jungle kangaroo lion apple banana cherry dog eagle fox grape horse igloo jungle kangaroo lion';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, true);
  assert.strictEqual(res.reason.includes('24-word recovery seed phrase'), true);
});

test('Ambiguous unlabeled 64-char hex produces advisory WARNING without hard blocking', () => {
  const text = 'just random 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef with no label';
  const res = detectSensitiveContent(text);
  assert.strictEqual(res.sensitive, false);
  assert.strictEqual(res.warning, true);
});

// ----------------------------------------------------
// SECTION 4: Monotonic Nonce Manager
// ----------------------------------------------------
console.log('\n--- Section 4: Monotonic Nonce Manager ---');

test('NonceManager generates strictly increasing nonces', () => {
  const nm = new NonceManager();
  const n1 = nm.nextNonce('did:key:test', 'lobby');
  const n2 = nm.nextNonce('did:key:test', 'lobby');
  const n3 = nm.nextNonce('did:key:test', 'lobby');
  assert.strictEqual(BigInt(n2) > BigInt(n1), true);
  assert.strictEqual(BigInt(n3) > BigInt(n2), true);
});

test('NonceManager recovers from server rejection with advancement', () => {
  const nm = new NonceManager();
  const rejectedNonce = '1725000000000';
  const recovered = nm.recoverFromRejection('did:key:test', 'lobby', rejectedNonce, 'nonce must be greater than 1725000000000');
  assert.strictEqual(BigInt(recovered) > BigInt(rejectedNonce), true);
});

// ----------------------------------------------------
// SECTION 5: DID Registry Paths
// ----------------------------------------------------
console.log('\n--- Section 5: DID Registry Paths ---');

await testAsync('Canonical sharded registry path /kv/did-<shard>/<key> calculation', async () => {
  const sampleDid = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
  const res = await deriveRegistryPath(sampleDid);
  assert.strictEqual(res.fingerprint.length, 16);
  assert.strictEqual(res.shard.length, 2);
  assert.strictEqual(res.key.length, 14);
  assert.strictEqual(res.canonicalPath, `/kv/did-${res.shard}/${res.key}`);
  assert.strictEqual(res.legacyPath, `/kv/did/${res.fingerprint}`);
});

// ----------------------------------------------------
// SECTION 6: Sonnet Challenge Mechanics
// ----------------------------------------------------
console.log('\n--- Section 6: Sonnet Challenge Mechanics ---');

test('Candidate Word Checker: letters in registered DID', () => {
  const didA = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
  // "The" -> t, h, e are all in didA (prefix did:key provides d, e; t, h are in didA)
  const check1 = checkDidLetterCompatibility('The', didA);
  assert.strictEqual(check1.compatible, true);

  // Case-insensitivity & letter reuse
  const check2 = checkDidLetterCompatibility('THE;', didA);
  assert.strictEqual(check2.compatible, true);

  // Missing letters
  const check3 = checkDidLetterCompatibility('wool', didA);
  assert.strictEqual(check3.compatible, false);
  assert.strictEqual(check3.missingLetters.includes('w'), true);
});

test('CMUdict syllable parsing: charges largest listed count per word', () => {
  const sampleDict = `
# Sample dictionary entry
THE DH AH0 # variant 1
THE(2) DH IY0 # variant 2
DEEDED D IY1 D IH0 D # 2 syllables
I AY1 # 1 syllable
`;
  const lexicon = parseCmudictLexicon(sampleDict);
  assert.strictEqual(lexicon.get('the'), 1);
  assert.strictEqual(lexicon.get('deeded'), 2);
  assert.strictEqual(lexicon.get('i'), 1);
});

test('Candidate word validator against lexicon and DID', () => {
  const sampleDict = `
THE DH AH0
WOOL W UH1 L
`;
  const lexicon = parseCmudictLexicon(sampleDict);
  const didA = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

  const validWord = validateCandidateWord('The', didA, lexicon);
  assert.strictEqual(validWord.valid, true);
  assert.strictEqual(validWord.syllables, 1);

  const missingLetterWord = validateCandidateWord('wool', didA, lexicon);
  assert.strictEqual(missingLetterWord.valid, false);
  assert.strictEqual(missingLetterWord.compatible, false);

  const unknownWord = validateCandidateWord('nonexistentword', didA, lexicon);
  assert.strictEqual(unknownWord.valid, false);
  assert.strictEqual(unknownWord.inDictionary, false);
});

test('Poem syllable validator: 14 lines x 10 syllables', () => {
  const sampleDict = `
I AY1
`;
  const lexicon = parseCmudictLexicon(sampleDict);
  const lines10Words = Array(14).fill('I I I I I I I I I I'); // 10 syllables per line

  const check = validatePoemSyllables(lines10Words, lexicon, true);
  assert.strictEqual(check.valid, true);
  assert.strictEqual(check.totalSyllables, 140);
  assert.deepStrictEqual(check.syllablesPerLine, Array(14).fill(10));
});

test('Poem syllable validator rejects overflow > 10 syllables', () => {
  const sampleDict = `
I AY1
`;
  const lexicon = parseCmudictLexicon(sampleDict);
  const linesOverflow = Array(14).fill('I I I I I I I I I I I'); // 11 syllables
  const check = validatePoemSyllables(linesOverflow, lexicon, false);
  assert.strictEqual(check.valid, false);
  assert.strictEqual(check.errors.length > 0, true);
});

await testAsync('Canonical poem UTF-8 serialization and SHA-256 calculation', async () => {
  const lines = [
    'The morning lays its gold upon the stone',
    'And wakes the fields beneath a silver sky',
    'I walk the path that once I walked alone',
    'And watch the last of nights pale shadows die',
    'Your voice returns within the waking light',
    'A song the patient river seems to know',
    'It keeps a little warmth against the night',
    'And follows where the quiet waters flow',
    'The years may take the roses from the wall',
    'And leave the gate to rust beneath the rain',
    'Yet still I turn whenever sparrows call',
    'As though your step might cross the path again',
    'What time has taken words can hold in trust',
    'A breath of love can rise above the dust'
  ];

  const canonicalText = formatCanonicalPoem(lines);
  // Must have 4 stanzas separated by \n\n (4, 4, 4, 2 lines)
  const stanzas = canonicalText.split('\n\n');
  assert.strictEqual(stanzas.length, 4);
  assert.strictEqual(stanzas[0].split('\n').length, 4);
  assert.strictEqual(stanzas[1].split('\n').length, 4);
  assert.strictEqual(stanzas[2].split('\n').length, 4);
  assert.strictEqual(stanzas[3].split('\n').length, 2);

  const hash = await computePoemSha256(canonicalText);
  assert.strictEqual(hash.length, 64);
  assert.strictEqual(/^[0-9a-f]{64}$/.test(hash), true);
});

test('Sonnet protocol payload builders format compact single-line JSON', () => {
  const regJson = buildRegistrationPayload({
    role: 'writer',
    xAccountUrl: 'https://x.com/agent_alice',
    requestId: 'reg-1'
  });
  const regParsed = JSON.parse(regJson);
  assert.strictEqual(regParsed.type, 'sonnet.register.v1');
  assert.strictEqual(regParsed.role, 'writer');
  assert.strictEqual(regParsed.x_account_url, 'https://x.com/agent_alice');

  const teamJson = buildTeamRequestPayload({ gameId: 'alpha-1', requestId: 'team-1' });
  const teamParsed = JSON.parse(teamJson);
  assert.strictEqual(teamParsed.type, 'sonnet.team-request.v1');
  assert.strictEqual(teamParsed.game_id, 'alpha-1');

  const wordJson = buildWordProposalPayload({
    gameId: 'alpha-1',
    roomGeneration: 0,
    version: 1,
    previousStateHash: 'e7ad4be948b9f3aef15d4aad4986c613e858a9faf78138b300bb6df7d14bcb8f',
    word: 'The',
    requestId: 'word-1'
  });
  const wordParsed = JSON.parse(wordJson);
  assert.strictEqual(wordParsed.type, 'sonnet.word.v1');
  assert.strictEqual(wordParsed.previous_state_hash, 'e7ad4be948b9f3aef15d4aad4986c613e858a9faf78138b300bb6df7d14bcb8f');

  const submitJson = buildSubmissionPayload({
    gameId: 'alpha-1',
    poemRoom: 'd-sonnet-1-team-alpha-1',
    roomGeneration: 0,
    finalVersion: 98,
    poemSha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
    xPostIds: ['1234567890'],
    requestId: 'sub-1'
  });
  const submitParsed = JSON.parse(submitJson);
  assert.strictEqual(submitParsed.type, 'sonnet.submit.v1');
  assert.strictEqual(submitParsed.poem_sha256, '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22');
});

// ----------------------------------------------------
// SECTION 7: Referee Receipt Engine
// ----------------------------------------------------
console.log('\n--- Section 7: Referee Receipt Engine ---');

test('ReceiptEngine separates transport success from referee acceptance', () => {
  const engine = new ReceiptEngine();
  const action = engine.recordDispatch({
    requestId: 'req-word-1',
    actionType: 'word',
    authenticatedDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    room: 'd-sonnet-1-team-a',
    payload: { word: 'The' },
    httpStatus: 200,
    transportSuccess: true
  });

  // Transport success occurred, but referee has NOT accepted yet
  assert.strictEqual(action.transportSuccess, true);
  assert.strictEqual(action.refereeAccepted, false);
  assert.strictEqual(action.status, 'SENT');

  // Referee receipt arrives in room
  const refereeMsg = {
    room: 'd-sonnet-1-team-a',
    seq: 42,
    ts: '2026-09-11T12:05:00.000000Z',
    from: 'did:key:z6MkRefereeTestKey12345678901234567890123456789012',
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.accepted.v1',
      request_id: 'req-word-1',
      game_id: 'a',
      version: 1,
      previous_state_hash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      status: 'accepted'
    })
  };

  const parsedReceipt = engine.ingestMessage(refereeMsg);
  assert.strictEqual(parsedReceipt !== null, true);
  assert.strictEqual(action.refereeAccepted, true);
  assert.strictEqual(action.status, 'ACCEPTED');
  assert.strictEqual(action.refereeReceipt.version, 1);

  // Authoritative game state updated
  const gameState = engine.getGameState('a');
  assert.strictEqual(gameState.version, 1);
  assert.strictEqual(gameState.lastContributor, action.authenticatedDid);
});

test('ReceiptEngine detects stale or out-of-order state updates', () => {
  const engine = new ReceiptEngine();
  engine.updateGameState('game-beta', { version: 5, stateHash: 'hash-5' });

  // Receipt with version 3 is stale
  const staleMsg = {
    room: 'd-sonnet-1-team-game-beta',
    seq: 10,
    text: JSON.stringify({
      type: 'sonnet.receipt.accepted.v1',
      request_id: 'old-req',
      game_id: 'game-beta',
      version: 3,
      previous_state_hash: 'hash-2'
    })
  };
  const receipt = engine.ingestMessage(staleMsg);
  assert.strictEqual(receipt.isStale, true);
  // Game state version remains at 5
  assert.strictEqual(engine.getGameState('game-beta').version, 5);
});

// ----------------------------------------------------
// SECTION 8: Official Contest Asset Hashes
// ----------------------------------------------------
console.log('\n--- Section 8: Official Contest Asset Hashes ---');

import fs from 'fs';
import crypto from 'crypto';

test('CMUdict file matches official contest frozen SHA-256', () => {
  const dictBytes = fs.readFileSync('./cmudict.dict');
  const actualHash = crypto.createHash('sha256').update(dictBytes).digest('hex').toLowerCase();
  const expectedHash = '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22';
  assert.strictEqual(actualHash, expectedHash);
});

test('Contest JSON file matches official contest frozen SHA-256', () => {
  const contestBytes = fs.readFileSync('./contest.json');
  const actualHash = crypto.createHash('sha256').update(contestBytes).digest('hex').toLowerCase();
  const expectedHash = 'e7ad4be948b9f3aef15d4aad4986c613e858a9faf78138b300bb6df7d14bcb8f';
  assert.strictEqual(actualHash, expectedHash);
});

// ----------------------------------------------------
// SECTION 9: Transport Serialization & Proxy Forwarding
// ----------------------------------------------------
console.log('\n--- Section 9: Transport Serialization & Proxy Forwarding ---');

test('Signed POST serialization produces exact {did, sig, nonce, text} body', () => {
  const kp = generateKeypair(nacl);
  const nonce = 1773000000000;
  const room = 'lobby';
  const text = 'test message';
  const sig = signMessage(nacl, kp.secretKey, room, nonce, text);

  const postBody = JSON.stringify({
    did: kp.did,
    sig: sig,
    nonce: nonce,
    text: text
  });

  const parsed = JSON.parse(postBody);
  assert.strictEqual(parsed.did, kp.did);
  assert.strictEqual(parsed.sig, sig);
  assert.strictEqual(parsed.nonce, nonce);
  assert.strictEqual(parsed.text, text);
});

test('Signed GET fallback URL produces exact canonical path structure', () => {
  const kp = generateKeypair(nacl);
  const nonce = 1773000000000;
  const room = 'lobby';
  const text = 'test message';
  const sig = signMessage(nacl, kp.secretKey, room, nonce, text);

  const getUrl = `/r/${room}/say-signed/${kp.did}/${sig}/${nonce}/${encodeURIComponent(text)}`;
  assert.strictEqual(getUrl.includes('/r/lobby/say-signed/did:key:z6Mk'), true);
  assert.strictEqual(getUrl.endsWith('/test%20message'), true);
});

await testAsync('Vercel proxy handler forwards POST body, Content-Type, and status', async () => {
  const proxyModule = await import('./api/proxy.js');
  const handler = proxyModule.default;

  let capturedUrl = '';
  let capturedOptions = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ ok: true, seq: 99 })
    };
  };

  const req = {
    method: 'POST',
    url: '/api/proxy?url=https%3A%2F%2Ftechnocore.chat%2Fr%2Flobby',
    headers: { 'content-type': 'application/json', host: 'localhost' },
    body: { did: 'did:key:z6MkTest', sig: 'sig123', nonce: 12345, text: 'hello' }
  };

  let resStatus = 0;
  let resHeaders = {};
  let resBody = '';
  const res = {
    status(s) { resStatus = s; return this; },
    setHeader(k, v) { resHeaders[k] = v; return this; },
    send(b) { resBody = b; return this; }
  };

  await handler(req, res);
  globalThis.fetch = originalFetch;

  assert.strictEqual(resStatus, 200);
  assert.strictEqual(capturedUrl, 'https://technocore.chat/r/lobby');
  assert.strictEqual(capturedOptions.method, 'POST');
  assert.strictEqual(capturedOptions.headers['Content-Type'], 'application/json');
  assert.strictEqual(JSON.parse(capturedOptions.body).text, 'hello');
  assert.strictEqual(JSON.parse(resBody).seq, 99);
});

// ----------------------------------------------------
// SECTION 10: Poller Backoff & Retry Logic
// ----------------------------------------------------
console.log('\n--- Section 10: Poller Backoff & Retry Logic ---');

await testAsync('RoomPoller computes exponential backoff with jitter on 429 and 503', async () => {
  const { RoomPoller } = await import('./transport.js');
  const poller = new RoomPoller('test-room', {});

  const b0 = poller.computeBackoff(0);
  assert.strictEqual(b0 >= 1000 && b0 <= 1500, true);

  const b1 = poller.computeBackoff(1);
  assert.strictEqual(b1 >= 2000 && b1 <= 3000, true);

  const b2 = poller.computeBackoff(2);
  assert.strictEqual(b2 >= 4000 && b2 <= 6000, true);

  const bMax = poller.computeBackoff(10);
  assert.strictEqual(bMax <= 30500, true);
});

console.log('\n========================================');
console.log(`TEST RESULTS: ${passedTests} passed, ${failedTests} failed`);
console.log('========================================\n');

if (failedTests > 0) {
  process.exit(1);
}


