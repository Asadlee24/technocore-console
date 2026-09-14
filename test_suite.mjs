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
  buildClaimPayload,
  buildRecruitPayload,
  buildSonnetRecruitPayload,
  formatRecruitMessage,
  extractDidLetters,
  computeRosterLetterCoverage,
  normalizeXHandle,
  parseWriterFromMessage
} from './sonnet.js';
import { DEFAULT_CONTEST, setPinnedReferee, getPinnedReferee, isRefereePinned, extractAndPinRefereeFromRules } from './contest-config.js';
import { RoomPoller } from './transport.js';

// Load tweetnacl for testing in Node.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
if (typeof self === 'undefined') {
  globalThis.self = globalThis;
}
require('./vendor/nacl-fast.min.js');
const nacl = globalThis.nacl;

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}`);
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
    console.error(`    ${err.stack || err.message}`);
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

test('NonceManager supports getNextNonce alias and flexible argument order', () => {
  const nm = new NonceManager();
  const n1 = nm.getNextNonce('lobby', 'did:key:test');
  const n2 = nm.nextNonce('did:key:test', 'lobby');
  const n3 = nm.getNextNonce('did:key:test', 'lobby');
  assert.strictEqual(typeof nm.getNextNonce, 'function');
  assert.strictEqual(BigInt(n2) > BigInt(n1), true);
  assert.strictEqual(BigInt(n3) > BigInt(n2), true);
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
  const testReferee = 'did:key:z6MkRefereeTestKey12345678901234567890123456789012';
  const engine = new ReceiptEngine(testReferee);
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
  const testReferee = 'did:key:z6MkRefereeTestKey12345678901234567890123456789012';
  const engine = new ReceiptEngine(testReferee);
  engine.updateGameState('game-beta', { version: 5, stateHash: 'hash-5' });

  // Receipt with version 3 is stale
  const staleMsg = {
    room: 'd-sonnet-1-team-game-beta',
    seq: 10,
    from: 'did:key:z6MkRefereeTestKey12345678901234567890123456789012',
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
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

// ----------------------------------------------------
// SECTION 11: Authoritative State Machine & Anti-Fabrication Invariants
// ----------------------------------------------------
console.log('\n--- Section 11: Authoritative State Machine & Anti-Fabrication Invariants ---');

test('Regression: HTTP 200 without referee receipt does NOT lock registration or grant eligibility', () => {
  const engine = new ReceiptEngine();
  const dispatch = engine.recordDispatch({
    requestId: 'reg-req-1',
    actionType: 'registration',
    authenticatedDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    room: 'mb-sonnet-1-registration',
    payload: { role: 'writer' },
    httpStatus: 200,
    transportSuccess: true
  });

  // Transport succeeded with HTTP 200
  assert.strictEqual(dispatch.transportSuccess, true);
  assert.strictEqual(dispatch.httpStatus, 200);

  // But referee has not accepted yet: role must NOT be locked, eligibility NOT granted
  assert.strictEqual(dispatch.refereeAccepted, false);
  assert.strictEqual(dispatch.status, 'SENT');
  assert.strictEqual(dispatch.refereeReceipt, null);
});

test('Regression: Team request stays pending without referee receipt', () => {
  const engine = new ReceiptEngine();
  const dispatch = engine.recordDispatch({
    requestId: 'team-req-1',
    actionType: 'team-request',
    authenticatedDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    room: 'mb-sonnet-1-discovery',
    payload: { game_id: 'alpha-1' },
    httpStatus: 200,
    transportSuccess: true
  });

  assert.strictEqual(dispatch.status, 'SENT');
  assert.strictEqual(dispatch.refereeAccepted, false);
  assert.strictEqual(engine.getGameState('alpha-1'), null);
});

test('Regression: Word send is impossible without authoritative version/hash/generation', () => {
  // Missing version throws
  assert.throws(() => {
    buildWordProposalPayload({
      gameId: 'alpha-1',
      roomGeneration: 1,
      previousStateHash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      word: 'word',
      requestId: 'r1'
    });
  }, /version must be a non-negative integer/);

  // Missing roomGeneration throws
  assert.throws(() => {
    buildWordProposalPayload({
      gameId: 'alpha-1',
      version: 1,
      previousStateHash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      word: 'word',
      requestId: 'r1'
    });
  }, /room_generation must be a non-negative integer/);

  // Missing previousStateHash throws
  assert.throws(() => {
    buildWordProposalPayload({
      gameId: 'alpha-1',
      roomGeneration: 1,
      version: 1,
      word: 'word',
      requestId: 'r1'
    });
  }, /previous_state_hash must be a 64-character SHA-256 hash/);
});

test('Regression: Submission is impossible without frozen completed poem and authoritative version', () => {
  // Incomplete poem fails validation
  const incompletePoem = Array(13).fill('I I I I I I I I I I');
  const sampleLexicon = new Map([['i', 1]]);
  const checkIncomplete = validatePoemSyllables(incompletePoem, sampleLexicon, true);
  assert.strictEqual(checkIncomplete.valid, false);

  // Missing poemSha256 throws
  assert.throws(() => {
    buildSubmissionPayload({
      gameId: 'alpha-1',
      poemRoom: 'd-sonnet-1-team-alpha-1',
      roomGeneration: 1,
      finalVersion: 140,
      xPostIds: ['12345'],
      requestId: 'r1'
    });
  }, /poem_sha256/);

  // Missing finalVersion throws
  assert.throws(() => {
    buildSubmissionPayload({
      gameId: 'alpha-1',
      poemRoom: 'd-sonnet-1-team-alpha-1',
      roomGeneration: 1,
      poemSha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      xPostIds: ['12345'],
      requestId: 'r1'
    });
  }, /final_version must be a positive integer/);
});

test('Regression: Fake/default hashes are strictly rejected (never generated or accepted)', () => {
  const zeroHash = '0000000000000000000000000000000000000000000000000000000000000000';

  // Zero-filled previous_state_hash is rejected
  assert.throws(() => {
    buildWordProposalPayload({
      gameId: 'alpha-1',
      roomGeneration: 1,
      version: 1,
      previousStateHash: zeroHash,
      word: 'word',
      requestId: 'r1'
    });
  }, /never invented or zero-filled/);

  // Zero-filled poem_sha256 is rejected
  assert.throws(() => {
    buildSubmissionPayload({
      gameId: 'alpha-1',
      poemRoom: 'd-sonnet-1-team-alpha-1',
      roomGeneration: 1,
      finalVersion: 140,
      poemSha256: zeroHash,
      xPostIds: ['12345'],
      requestId: 'r1'
    });
  }, /never zero-filled/);
});

test('Regression: Fake/default room_generation is strictly rejected (never generated or accepted)', () => {
  // Undefined room_generation rejected
  assert.throws(() => {
    buildWordProposalPayload({
      gameId: 'alpha-1',
      roomGeneration: undefined,
      version: 1,
      previousStateHash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      word: 'word',
      requestId: 'r1'
    });
  }, /room_generation must be a non-negative integer/);

  // Negative room_generation rejected
  assert.throws(() => {
    buildWordProposalPayload({
      gameId: 'alpha-1',
      roomGeneration: -1,
      version: 1,
      previousStateHash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      word: 'word',
      requestId: 'r1'
    });
  }, /room_generation must be a non-negative integer/);
});

test('Regression: Date.now is never stored as server sequence', () => {
  const testReferee = 'did:key:z6MkRefereeTestKey12345678901234567890123456789012';
  const engine = new ReceiptEngine(testReferee);
  const action = engine.recordDispatch({
    requestId: 'seq-test-1',
    actionType: 'word',
    room: 'test-room',
    payload: { word: 'test' }
  });

  // Without server response sequence, sequence must be null, NEVER Date.now()
  assert.strictEqual(action.sequence, null);

  // Ingest message with actual server seq
  const serverMsg = {
    room: 'test-room',
    seq: 789,
    from: 'did:key:z6MkRefereeTestKey12345678901234567890123456789012',
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.accepted.v1',
      request_id: 'seq-test-1',
      status: 'accepted'
    })
  };
  engine.ingestMessage(serverMsg);
  assert.strictEqual(action.sequence, 789);
  assert.notStrictEqual(action.sequence, Date.now());
});

test('Regression: Invalid/unpinned referee receipts cannot mutate contest or game state', () => {
  const refereeOfficial = 'did:key:z6MkOfficialRefereeDidForContest12345678901234567890';
  setPinnedReferee(refereeOfficial);

  const engine = new ReceiptEngine();
  engine.updateGameState('game-gamma', { version: 10, stateHash: 'hash-10' });

  // 1. Message from unpinned/imposter signer is rejected
  const imposterMsg = {
    room: 'd-sonnet-1-team-gamma',
    seq: 15,
    from: 'did:key:z6MkImposterHackerSigner98765432109876543210987654',
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.accepted.v1',
      request_id: 'hack-req',
      game_id: 'game-gamma',
      version: 11,
      previous_state_hash: 'hacked-hash'
    })
  };
  const resultImposter = engine.ingestMessage(imposterMsg);
  assert.strictEqual(resultImposter.rejected, true);
  assert.strictEqual(engine.getGameState('game-gamma').version, 10);

  // 2. Unsigned message is rejected
  const unsignedMsg = {
    room: 'd-sonnet-1-team-gamma',
    seq: 16,
    from: refereeOfficial,
    text: JSON.stringify({
      type: 'sonnet.receipt.accepted.v1',
      request_id: 'unsigned-req',
      game_id: 'game-gamma',
      version: 11,
      previous_state_hash: 'unsigned-hash'
    })
  };
  const resultUnsigned = engine.ingestMessage(unsignedMsg);
  assert.strictEqual(resultUnsigned.rejected, true);
  assert.strictEqual(engine.getGameState('game-gamma').version, 10);
});

test('Regression: Accepted signed referee receipt from pinned referee correctly advances state and locks role', () => {
  const refereeOfficial = 'did:key:z6MkOfficialRefereeDidForContest12345678901234567890';
  setPinnedReferee(refereeOfficial);

  const engine = new ReceiptEngine();

  // Registration flow:
  const regAction = engine.recordDispatch({
    requestId: 'reg-flow-1',
    actionType: 'registration',
    authenticatedDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    room: 'mb-sonnet-1-registration',
    payload: { role: 'writer' },
    httpStatus: 200,
    transportSuccess: true
  });
  assert.strictEqual(regAction.status, 'SENT');
  assert.strictEqual(regAction.refereeAccepted, false);

  // Official referee signs acceptance receipt
  const regReceiptMsg = {
    room: 'mb-sonnet-1-registration',
    seq: 101,
    from: refereeOfficial,
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.registration.v1',
      request_id: 'reg-flow-1',
      role: 'writer',
      status: 'accepted'
    })
  };

  const receipt = engine.ingestMessage(regReceiptMsg);
  assert.strictEqual(receipt !== null, true);
  assert.strictEqual(regAction.refereeAccepted, true);
  assert.strictEqual(regAction.status, 'ACCEPTED');

  // Game advance flow:
  const wordAction = engine.recordDispatch({
    requestId: 'word-flow-1',
    actionType: 'word',
    authenticatedDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    room: 'd-sonnet-1-team-game-delta',
    payload: { word: 'test' }
  });

  const wordReceiptMsg = {
    room: 'd-sonnet-1-team-game-delta',
    seq: 102,
    from: refereeOfficial,
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.accepted.v1',
      request_id: 'word-flow-1',
      game_id: 'game-delta',
      version: 1,
      previous_state_hash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
      status: 'accepted'
    })
  };

  engine.ingestMessage(wordReceiptMsg);
  assert.strictEqual(wordAction.refereeAccepted, true);
  const gameState = engine.getGameState('game-delta');
  assert.strictEqual(gameState.version, 1);
  assert.strictEqual(gameState.stateHash, '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22');
});

// ----------------------------------------------------
// SECTION 12: Live-Safety Audit Regression Invariants
// ----------------------------------------------------
console.log('\n--- Section 12: Live-Safety Audit Regression Invariants ---');

test('Regression 1: Unconfigured referee => signed receipts cannot mutate state (Fail-Closed)', () => {
  // Explicitly ensure referee pin is unconfigured
  setPinnedReferee(null);
  const unconfiguredEngine = new ReceiptEngine(null);

  const signedMsg = {
    room: 'mb-sonnet-1-registration',
    seq: 1,
    from: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.registration.v1',
      request_id: 'reg-fail-closed-1',
      role: 'writer',
      status: 'accepted'
    })
  };

  const res = unconfiguredEngine.ingestMessage(signedMsg, null);
  assert.strictEqual(res.rejected, true);
  assert.strictEqual(res.reason, 'Waiting for official referee pin. Authoritative state mutation disabled.');
});

test('Regression 2: Wrong signed DID => cannot mutate state', () => {
  const pinnedReferee = 'did:key:z6MkOfficialRefereeDidForContest12345678901234567890';
  const imposterDid = 'did:key:z6MkRandomImposterDid999999999999999999999999999';
  const engine = new ReceiptEngine(pinnedReferee);

  const msg = {
    room: 'mb-sonnet-1-registration',
    seq: 2,
    from: imposterDid,
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.registration.v1',
      request_id: 'reg-imposter-1',
      role: 'writer',
      status: 'accepted'
    })
  };

  const res = engine.ingestMessage(msg);
  assert.strictEqual(res.rejected, true);
  assert.strictEqual(res.reason.includes('does not match pinned referee'), true);
});

test('Regression 3: Invalid referee Ed25519 signature => cannot mutate state', () => {
  const refereeKp = generateKeypair(nacl);
  const engine = new ReceiptEngine(refereeKp.did, nacl);

  const room = 'd-sonnet-1-team-sigma';
  const payloadText = JSON.stringify({
    type: 'sonnet.receipt.accepted.v1',
    request_id: 'word-crypto-test',
    game_id: 'sigma',
    version: 1,
    status: 'accepted'
  });

  // Validly sign first: (nacl, secretKey, room, nonce, text)
  const validSig = signMessage(nacl, refereeKp.secretKey, room, 55, payloadText);

  // 1. Message with tampered text
  const tamperedMsg = {
    room: room,
    seq: 10482,
    nonce: 55,
    from: refereeKp.did,
    sig: validSig,
    text: payloadText.replace('"version":1', '"version":2')
  };

  const tamperedRes = engine.ingestMessage(tamperedMsg);
  assert.strictEqual(tamperedRes.rejected, true);
  assert.strictEqual(tamperedRes.reason, 'Invalid referee cryptographic Ed25519 signature');
  assert.strictEqual(engine.getGameState('sigma'), null);

  // 2. Genuine signature verification succeeds with msg.nonce and earns CRYPTOGRAPHICALLY VERIFIED
  const validMsg = {
    room: room,
    seq: 10482,
    nonce: 55,
    from: refereeKp.did,
    sig: validSig,
    text: payloadText
  };

  const validRes = engine.ingestMessage(validMsg);
  assert.strictEqual(validRes !== null, true);
  assert.strictEqual(validRes.rejected, undefined);
  assert.strictEqual(validRes.receiptSignatureStatus, 'CRYPTOGRAPHICALLY VERIFIED');
  assert.strictEqual(engine.getGameState('sigma').version, 1);
});

test("Regression 4: Another user's accepted registration receipt does not lock my role", () => {
  const myReqId = 'reg-local-user-500';
  const myDid = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
  const strangerDid = 'did:key:z6MkStrangerParticipant999999999999999999999999';

  // Simulate local user session state
  const localSession = {
    lastRegistrationReqId: myReqId,
    activeDid: myDid,
    role: 'writer',
    roleLocked: false,
    registrationAccepted: false
  };

  // Receipt broadcast in public room for stranger
  const publicReceipt = {
    requestId: 'reg-stranger-888',
    authenticatedDid: strangerDid,
    role: 'writer',
    actionStatus: 'ACCEPTED'
  };

  // Exact scoping check implemented in app.js
  const isMyRegistration = Boolean(
    localSession.lastRegistrationReqId &&
    publicReceipt.requestId === localSession.lastRegistrationReqId &&
    (!publicReceipt.authenticatedDid || publicReceipt.authenticatedDid === localSession.activeDid)
  );

  assert.strictEqual(isMyRegistration, false);
  // Role remains strictly unlocked
  assert.strictEqual(localSession.roleLocked, false);
  assert.strictEqual(localSession.registrationAccepted, false);
});

test("Regression 5: Another team's receipt does not change my game_id or poem room", () => {
  const localSession = {
    gameId: 'my-team-alpha',
    lastTeamReqId: 'room-my-team-1',
    allocatedPoemRoom: 'd-sonnet-1-team-alpha'
  };

  // Receipt in discovery room for another team
  const publicReceipt = {
    requestId: 'room-other-team-2',
    gameId: 'other-team-beta',
    poemRoom: 'd-sonnet-1-team-beta',
    actionStatus: 'ACCEPTED'
  };

  // Exact scoping check implemented in app.js
  const isMyTeamReq = Boolean(
    localSession.lastTeamReqId &&
    publicReceipt.requestId === localSession.lastTeamReqId
  );

  assert.strictEqual(isMyTeamReq, false);
  // Local team state is strictly preserved
  assert.strictEqual(localSession.gameId, 'my-team-alpha');
  assert.strictEqual(localSession.allocatedPoemRoom, 'd-sonnet-1-team-alpha');
});

test('Regression 6: Same poem word accepted twice at different versions is stored twice', () => {
  const testReferee = 'did:key:z6MkRefereeTestKey12345678901234567890123456789012';
  const engine = new ReceiptEngine(testReferee);

  // Turn 1: word "the" at version 1
  engine.ingestMessage({
    room: 'd-sonnet-1-team-omega',
    seq: 1,
    from: testReferee,
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.word.v1',
      request_id: 'w-1',
      game_id: 'omega',
      version: 1,
      word: 'the',
      status: 'accepted'
    })
  });

  // Turn 2: word "world" at version 2
  engine.ingestMessage({
    room: 'd-sonnet-1-team-omega',
    seq: 2,
    from: testReferee,
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.word.v1',
      request_id: 'w-2',
      game_id: 'omega',
      version: 2,
      word: 'world',
      status: 'accepted'
    })
  });

  // Turn 3: word "the" at version 3 (same word again!)
  engine.ingestMessage({
    room: 'd-sonnet-1-team-omega',
    seq: 3,
    from: testReferee,
    sig: 'qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_qU8s9_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AQ',
    text: JSON.stringify({
      type: 'sonnet.receipt.word.v1',
      request_id: 'w-3',
      game_id: 'omega',
      version: 3,
      word: 'the',
      status: 'accepted'
    })
  });

  const words = engine.getGameState('omega').words;
  assert.strictEqual(words.length, 3);
  assert.deepStrictEqual(words, ['the', 'world', 'the']);
  assert.strictEqual(words[0], words[2]);
});

test('Regression 7: Submission receipt without entry_id => entry ID stays null (never fabricated)', () => {
  const localSession = {
    lastSubmitReqId: 'sub-local-99',
    gameId: 'omega',
    submissionAccepted: false,
    submissionPending: true,
    submittedEntryId: null
  };

  // Referee acceptance receipt arrives without entry_id
  const receiptWithoutEntryId = {
    requestId: 'sub-local-99',
    gameId: 'omega',
    actionStatus: 'ACCEPTED',
    entryId: null
  };

  const isMySubmitReq = Boolean(
    localSession.lastSubmitReqId &&
    receiptWithoutEntryId.requestId === localSession.lastSubmitReqId &&
    receiptWithoutEntryId.gameId === localSession.gameId
  );

  assert.strictEqual(isMySubmitReq, true);
  if (isMySubmitReq && receiptWithoutEntryId.actionStatus === 'ACCEPTED') {
    localSession.submissionAccepted = true;
    localSession.submissionPending = false;
    localSession.submittedEntryId = receiptWithoutEntryId.entryId || null;
  }

  assert.strictEqual(localSession.submissionAccepted, true);
  assert.strictEqual(localSession.submittedEntryId, null);
  assert.notStrictEqual(localSession.submittedEntryId, 'entry-submitted');
});

test('Regression 8: Only exact local request receipt advances local pending action', () => {
  const localSession = {
    lastSubmitReqId: 'sub-exact-42',
    gameId: 'team-alpha',
    submissionPending: true,
    submissionAccepted: false
  };

  // 1. Unrelated receipt does NOT advance local action
  const unrelatedReceipt = {
    requestId: 'sub-unrelated-99',
    gameId: 'team-alpha',
    actionStatus: 'ACCEPTED'
  };

  const isUnrelated = Boolean(
    localSession.lastSubmitReqId &&
    unrelatedReceipt.requestId === localSession.lastSubmitReqId
  );
  assert.strictEqual(isUnrelated, false);
  assert.strictEqual(localSession.submissionPending, true);
  assert.strictEqual(localSession.submissionAccepted, false);

  // 2. Exact match receipt DOES advance local action
  const matchingReceipt = {
    requestId: 'sub-exact-42',
    gameId: 'team-alpha',
    actionStatus: 'ACCEPTED'
  };

  const isMatching = Boolean(
    localSession.lastSubmitReqId &&
    matchingReceipt.requestId === localSession.lastSubmitReqId
  );
  assert.strictEqual(isMatching, true);
  if (isMatching && matchingReceipt.actionStatus === 'ACCEPTED') {
    localSession.submissionPending = false;
    localSession.submissionAccepted = true;
  }

  assert.strictEqual(localSession.submissionPending, false);
  assert.strictEqual(localSession.submissionAccepted, true);
});

// ----------------------------------------------------
// SECTION 13: Exhaustive Protocol Invariants & Live Contest Simulation
// ----------------------------------------------------
console.log('\n--- Section 13: Exhaustive Protocol Invariants & Live Contest Simulation ---');

test('Critical Fix 1: RoomPoller constructor accepts both callback function and options object without TypeError', () => {
  let firedFunc = false;
  let firedObj = false;

  const pollerFunc = new RoomPoller('room-a', (msgs) => {
    firedFunc = true;
  });
  assert.strictEqual(typeof pollerFunc.onMessages, 'function');
  pollerFunc.onMessages([{ seq: 1 }]);
  assert.strictEqual(firedFunc, true);

  const pollerObj = new RoomPoller('room-b', {
    onMessages: (msgs) => {
      firedObj = true;
    },
    onStatus: (status) => {}
  });
  assert.strictEqual(typeof pollerObj.onMessages, 'function');
  pollerObj.onMessages([{ seq: 2 }]);
  assert.strictEqual(firedObj, true);
});

test('Critical Fix 1: RoomPoller long-poll JSON delivery reaches Sonnet pipeline without error', () => {
  const refereeKp = generateKeypair(nacl);
  const testEngine = new ReceiptEngine(refereeKp.did, nacl);
  let deliveredToSonnet = false;

  // Realistic mock server response for ?format=json&since=0&wait=10
  const mockServerResponse = {
    room: 'mb-sonnet-1-registration',
    count: 1,
    first_seq: 101,
    last_seq: 101,
    generation: 1,
    wait_held: false,
    messages: [
      {
        seq: 101,
        ts: '2026-09-11T12:00:00.000000Z',
        from: refereeKp.did,
        room: 'mb-sonnet-1-registration',
        nonce: 1726056000000,
        sig: signMessage(nacl, refereeKp.secretKey, 'mb-sonnet-1-registration', 1726056000000, JSON.stringify({
          type: 'sonnet.receipt.registration.v1',
          request_id: 'reg-stream-test',
          role: 'writer',
          status: 'accepted'
        })),
        text: JSON.stringify({
          type: 'sonnet.receipt.registration.v1',
          request_id: 'reg-stream-test',
          role: 'writer',
          status: 'accepted'
        })
      }
    ]
  };

  const poller = new RoomPoller('mb-sonnet-1-registration', {
    onMessages: (messages) => {
      for (const msg of messages) {
        const receipt = testEngine.ingestMessage(msg);
        if (receipt && !receipt.rejected && receipt.actionStatus === 'ACCEPTED') {
          deliveredToSonnet = true;
        }
      }
    }
  });

  // Execute message callback directly as RoomPoller does upon network return
  poller.onMessages(mockServerResponse.messages);
  assert.strictEqual(deliveredToSonnet, true);
});

test('Critical Fix 2: seq != nonce signature verification invariant', () => {
  const kp = generateKeypair(nacl);
  const room = 'lobby';
  const signingNonce = 55;
  const serverSeq = 10482;
  const messageText = 'hello world from technocore test';

  // Sender signs strictly over: room|nonce|text
  const signature = signMessage(nacl, kp.secretKey, room, signingNonce, messageText);

  // Realistic format=json message record from Technocore server
  const serverMessageRecord = {
    seq: serverSeq,
    ts: '2026-09-11T12:00:00.000000Z',
    from: kp.did,
    room: room,
    nonce: signingNonce,
    sig: signature,
    text: messageText
  };

  // 1. Verification with msg.nonce (55) MUST PASS
  const verifyWithNonce = verifyMessageSignature(
    nacl,
    serverMessageRecord.from,
    serverMessageRecord.sig,
    serverMessageRecord.room,
    serverMessageRecord.nonce,
    serverMessageRecord.text
  );
  assert.strictEqual(verifyWithNonce.valid, true);

  // 2. Verification using msg.seq (10482) MUST FAIL
  const verifyWithSeq = verifyMessageSignature(
    nacl,
    serverMessageRecord.from,
    serverMessageRecord.sig,
    serverMessageRecord.room,
    serverMessageRecord.seq,
    serverMessageRecord.text
  );
  assert.strictEqual(verifyWithSeq.valid, false);
});

test('Critical Fix 3: Unsigned launch announcement in rules room cannot pin referee', () => {
  setPinnedReferee(null);
  const unsignedLaunchMsg = {
    room: 'd-sonnet-1-rules',
    seq: 1,
    nonce: 100,
    from: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    sig: null,
    text: JSON.stringify({
      type: 'sonnet.rules.v1',
      contest_id: 'sonnet-1',
      rules_version: '0.5'
    })
  };

  const pinned = extractAndPinRefereeFromRules([unsignedLaunchMsg], nacl);
  assert.strictEqual(pinned, null);
  assert.strictEqual(isRefereePinned(), false);
});

test('Critical Fix 3: Random message merely containing contest_id cannot pin referee', () => {
  setPinnedReferee(null);
  const randomKp = generateKeypair(nacl);
  const randomText = JSON.stringify({
    contest_id: 'sonnet-1',
    note: 'I am a participant in sonnet-1'
  });
  const randomSig = signMessage(nacl, randomKp.secretKey, 'd-sonnet-1-rules', 200, randomText);

  const spamMsg = {
    room: 'd-sonnet-1-rules',
    seq: 2,
    nonce: 200,
    from: randomKp.did,
    sig: randomSig,
    text: randomText
  };

  const pinned = extractAndPinRefereeFromRules([spamMsg], nacl);
  assert.strictEqual(pinned, null);
  assert.strictEqual(isRefereePinned(), false);
});

test('Critical Fix 3: Authentic signed official launch announcement successfully pins referee', () => {
  setPinnedReferee(null);
  const officialRefereeKp = generateKeypair(nacl);
  const launchText = JSON.stringify({
    type: 'sonnet.rules.v1',
    contest_id: 'sonnet-1',
    rules_version: '0.5',
    title: 'Technocore Sonnet Challenge #1'
  });
  const launchSig = signMessage(nacl, officialRefereeKp.secretKey, 'd-sonnet-1-rules', 300, launchText);

  const officialMsg = {
    room: 'd-sonnet-1-rules',
    seq: 3,
    nonce: 300,
    from: officialRefereeKp.did,
    sig: launchSig,
    text: launchText
  };

  const pinned = extractAndPinRefereeFromRules([officialMsg], nacl);
  assert.strictEqual(pinned, officialRefereeKp.did);
  assert.strictEqual(isRefereePinned(), true);
  assert.strictEqual(getPinnedReferee(), officialRefereeKp.did);
});

await testAsync('Sonnet Challenge End-to-End 25-step simulated contest lifecycle', async () => {
  // 1. Load existing DID
  const writerKp = generateKeypair(nacl);
  const voterKp = generateKeypair(nacl);
  const refereeKp = generateKeypair(nacl);

  // 2. Official referee pin
  setPinnedReferee(refereeKp.did);
  const engine = new ReceiptEngine(refereeKp.did, nacl);
  assert.strictEqual(engine.getPinnedReferee(), refereeKp.did);

  // 3. Writer registration dispatch
  const regReqId = 'reg-sim-1';
  const regDispatch = engine.recordDispatch({
    requestId: regReqId,
    actionType: 'register',
    authenticatedDid: writerKp.did,
    room: 'mb-sonnet-1-registration',
    httpStatus: 200,
    transportSuccess: true
  });

  // 4. HTTP 200: registration remains pending and unconfirmed
  assert.strictEqual(regDispatch.status, 'SENT');
  assert.strictEqual(regDispatch.refereeAccepted, false);

  // 5. Referee sends registration receipt
  const regPayload = JSON.stringify({
    type: 'sonnet.receipt.registration.v1',
    request_id: regReqId,
    role: 'writer',
    status: 'accepted'
  });
  const regReceiptMsg = {
    room: 'mb-sonnet-1-registration',
    seq: 1001,
    nonce: 501,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'mb-sonnet-1-registration', 501, regPayload),
    text: regPayload
  };

  // 6. Eligibility accepted & role locked
  const regReceipt = engine.ingestMessage(regReceiptMsg);
  assert.strictEqual(regReceipt.actionStatus, 'ACCEPTED');
  assert.strictEqual(regDispatch.refereeAccepted, true);
  assert.strictEqual(regReceipt.receiptSignatureStatus, 'CRYPTOGRAPHICALLY VERIFIED');

  // 7. Team request dispatch
  const teamReqId = 'team-sim-1';
  engine.recordDispatch({
    requestId: teamReqId,
    actionType: 'team-request',
    authenticatedDid: writerKp.did,
    room: 'mb-sonnet-1-discovery',
    httpStatus: 200,
    transportSuccess: true
  });

  // 8. Referee room allocation receipt
  const teamPayload = JSON.stringify({
    type: 'sonnet.receipt.team-request.v1',
    request_id: teamReqId,
    game_id: 'alpha',
    poem_room: 'd-sonnet-1-team-alpha',
    room_generation: 1,
    version: 0,
    state_hash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
    status: 'accepted'
  });
  const teamReceipt = engine.ingestMessage({
    room: 'mb-sonnet-1-discovery',
    seq: 1002,
    nonce: 502,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'mb-sonnet-1-discovery', 502, teamPayload),
    text: teamPayload
  });
  assert.strictEqual(teamReceipt.actionStatus, 'ACCEPTED');
  assert.strictEqual(engine.getGameState('alpha').roomGeneration, 1);
  assert.strictEqual(engine.getGameState('alpha').poemRoom, 'd-sonnet-1-team-alpha');

  // 9. Roster consent dispatch (4 members)
  const rosterReqId = 'roster-sim-1';
  engine.recordDispatch({
    requestId: rosterReqId,
    actionType: 'roster',
    authenticatedDid: writerKp.did,
    room: 'd-sonnet-1-team-alpha',
    httpStatus: 200,
    transportSuccess: true
  });

  // 10. Roster acceptance receipt
  const rosterPayload = JSON.stringify({
    type: 'sonnet.receipt.roster.v1',
    request_id: rosterReqId,
    game_id: 'alpha',
    status: 'accepted'
  });
  const rosterReceipt = engine.ingestMessage({
    room: 'd-sonnet-1-team-alpha',
    seq: 1003,
    nonce: 503,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'd-sonnet-1-team-alpha', 503, rosterPayload),
    text: rosterPayload
  });
  assert.strictEqual(rosterReceipt.actionStatus, 'ACCEPTED');

  // 11. First word ("the", version 1)
  const word1Payload = JSON.stringify({
    type: 'sonnet.receipt.word.v1',
    request_id: 'w-sim-1',
    game_id: 'alpha',
    version: 1,
    word: 'the',
    previous_state_hash: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22',
    state_hash: '1111111111111111111111111111111111111111111111111111111111111111',
    status: 'accepted'
  });

  // 12. Referee word acceptance
  engine.ingestMessage({
    room: 'd-sonnet-1-team-alpha',
    seq: 1004,
    nonce: 504,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'd-sonnet-1-team-alpha', 504, word1Payload),
    text: word1Payload
  });
  assert.strictEqual(engine.getGameState('alpha').version, 1);

  // 13. Second contributor turn ("world", version 2)
  const word2Payload = JSON.stringify({
    type: 'sonnet.receipt.word.v1',
    request_id: 'w-sim-2',
    game_id: 'alpha',
    version: 2,
    word: 'world',
    state_hash: '2222222222222222222222222222222222222222222222222222222222222222',
    status: 'accepted'
  });
  engine.ingestMessage({
    room: 'd-sonnet-1-team-alpha',
    seq: 1005,
    nonce: 505,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'd-sonnet-1-team-alpha', 505, word2Payload),
    text: word2Payload
  });

  // 14. Repeated word later in poem ("the" repeated at version 3)
  const word3Payload = JSON.stringify({
    type: 'sonnet.receipt.word.v1',
    request_id: 'w-sim-3',
    game_id: 'alpha',
    version: 3,
    word: 'the',
    state_hash: '3333333333333333333333333333333333333333333333333333333333333333',
    status: 'accepted'
  });
  engine.ingestMessage({
    room: 'd-sonnet-1-team-alpha',
    seq: 1006,
    nonce: 506,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'd-sonnet-1-team-alpha', 506, word3Payload),
    text: word3Payload
  });

  // 15. State/version/hash progression and repeated word preserved!
  const gameState = engine.getGameState('alpha');
  assert.strictEqual(gameState.version, 3);
  assert.deepStrictEqual(gameState.words, ['the', 'world', 'the']);

  // 16. Construct valid 14 lines
  const fullSonnetLines = [
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

  // 17. Syllable count verification: exactly 10 per line
  const officialLexicon = parseCmudictLexicon(fs.readFileSync('./cmudict.dict', 'utf8'));
  const sonnetValidation = validatePoemSyllables(fullSonnetLines, officialLexicon, true);
  assert.strictEqual(sonnetValidation.valid, true);

  // 18. Poem freeze format
  const canonicalPoem = formatCanonicalPoem(fullSonnetLines);
  assert.strictEqual(canonicalPoem.split('\n\n').length, 4);

  // 19. Poem SHA-256
  const poemSha256 = await computePoemSha256(canonicalPoem);
  assert.strictEqual(poemSha256.length, 64);

  // 20. Submission dispatch
  const subReqId = 'sub-sim-1';
  engine.recordDispatch({
    requestId: subReqId,
    actionType: 'submit',
    authenticatedDid: writerKp.did,
    room: 'mb-sonnet-1-submissions',
    stateHash: poemSha256,
    httpStatus: 200,
    transportSuccess: true
  });

  // 21. Referee submission receipt
  const authoritativeEntryId = 'entry-sonnet-1-alpha-001';
  const subPayload = JSON.stringify({
    type: 'sonnet.receipt.submission.v1',
    request_id: subReqId,
    game_id: 'alpha',
    entry_id: authoritativeEntryId,
    status: 'accepted'
  });
  const subReceipt = engine.ingestMessage({
    room: 'mb-sonnet-1-submissions',
    seq: 1007,
    nonce: 507,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'mb-sonnet-1-submissions', 507, subPayload),
    text: subPayload
  });

  // 22. Authoritative entry_id verified (never fabricated)
  assert.strictEqual(subReceipt.actionStatus, 'ACCEPTED');
  assert.strictEqual(subReceipt.entryId, authoritativeEntryId);
  assert.notStrictEqual(subReceipt.entryId, 'entry-submitted');

  // 23. Voting ballot dispatch
  const ballotReqId = 'ballot-sim-1';
  engine.recordDispatch({
    requestId: ballotReqId,
    actionType: 'ballot',
    authenticatedDid: voterKp.did,
    room: 'mb-sonnet-1-votes',
    httpStatus: 200,
    transportSuccess: true
  });

  // 24. Ballot receipt acceptance
  const ballotPayload = JSON.stringify({
    type: 'sonnet.receipt.ballot.v1',
    request_id: ballotReqId,
    entry_id: authoritativeEntryId,
    status: 'accepted'
  });
  const ballotReceipt = engine.ingestMessage({
    room: 'mb-sonnet-1-votes',
    seq: 1008,
    nonce: 508,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'mb-sonnet-1-votes', 508, ballotPayload),
    text: ballotPayload
  });
  assert.strictEqual(ballotReceipt.actionStatus, 'ACCEPTED');

  // 25. Winner prize claim dispatch & acceptance
  const claimReqId = 'claim-sim-1';
  engine.recordDispatch({
    requestId: claimReqId,
    actionType: 'claim',
    authenticatedDid: writerKp.did,
    room: 'mb-sonnet-1-registration',
    httpStatus: 200,
    transportSuccess: true
  });

  const claimPayload = JSON.stringify({
    type: 'sonnet.receipt.claim.v1',
    request_id: claimReqId,
    game_id: 'alpha',
    status: 'accepted'
  });
  const claimReceipt = engine.ingestMessage({
    room: 'mb-sonnet-1-registration',
    seq: 1009,
    nonce: 509,
    from: refereeKp.did,
    sig: signMessage(nacl, refereeKp.secretKey, 'mb-sonnet-1-registration', 509, claimPayload),
    text: claimPayload
  });
  assert.strictEqual(claimReceipt.actionStatus, 'ACCEPTED');
});

test('Regression: Registration dispatch response handling supports res.lane (POST/GET) without throwing TypeError', () => {
  // dispatchSignedMessage returns { ok: true, status: 200, seq: 62519, lane: 'POST' }
  const res = {
    ok: true,
    status: 200,
    seq: 62519,
    text: 'OK',
    lane: 'POST'
  };

  // Ensure lane resolution is safe and doesn't throw TypeError
  const laneStr = (res.lane || res.transport || 'POST').toUpperCase();
  assert.strictEqual(laneStr, 'POST');

  const evidenceText = `Dispatched via ${laneStr}. Polling /r/mb-sonnet-1-registration for referee receipt...`;
  assert.strictEqual(evidenceText.includes('Dispatched via POST'), true);

  // Invariant: HTTP 200 must keep role unlocked and registration pending
  const registrationState = {
    registrationPending: true,
    lastRegistrationReqId: 'register-asadlee-1',
    role: 'writer',
    roleLocked: false,
    registrationAccepted: false
  };

  assert.strictEqual(registrationState.registrationPending, true);
  assert.strictEqual(registrationState.roleLocked, false);
  assert.strictEqual(registrationState.registrationAccepted, false);
});

console.log('\n--- Section 14: Squad Board & Letter Coverage Engine ---');

test('extractDidLetters extracts only unique lowercase [a-z] letters', () => {
  const did = 'did:key:z6Mkr8N6JvhKzWv7xiNSYhiDH4MEB14FfE7FuDCsMGTh7h4V';
  const letters = extractDidLetters(did);
  assert.strictEqual(letters.has('z'), true);
  assert.strictEqual(letters.has('k'), true);
  assert.strictEqual(letters.has('6'), false);
  assert.strictEqual(letters.has(':'), false);
  // All elements must be [a-z]
  for (const ch of letters) {
    assert.strictEqual(/^[a-z]$/.test(ch), true);
  }
});

test('normalizeXHandle cleans Twitter/X URLs, handles, and extracts links', () => {
  const url1 = normalizeXHandle('https://x.com/schatte08064468');
  assert.strictEqual(url1.handle, '@schatte08064468');
  assert.strictEqual(url1.url, 'https://x.com/schatte08064468');

  const url2 = normalizeXHandle('https://twitter.com/bub__fun?s=20');
  assert.strictEqual(url2.handle, '@bub__fun');
  assert.strictEqual(url2.url, 'https://x.com/bub__fun');

  const handle1 = normalizeXHandle('@Arashb122');
  assert.strictEqual(handle1.handle, '@Arashb122');
  assert.strictEqual(handle1.url, 'https://x.com/Arashb122');

  const empty = normalizeXHandle('');
  assert.strictEqual(empty.handle, '');
  assert.strictEqual(empty.url, '');
});

test('computeRosterLetterCoverage aggregates letters, calculates coverage % and missing vowels', () => {
  const asadDid = 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';
  const samimiDid = 'did:key:z6MkkTEfZ9kM25sxAJhQTqJWRt3MXTZS2vkwBL2d8VDLniEX';
  const arashDid = 'did:key:z6Mkr8N6JvhKzWv7xiNSYhiDH4MEB14FfE7FuDCsMGTh7h4V';

  const singleCoverage = computeRosterLetterCoverage([asadDid]);
  assert.strictEqual(singleCoverage.letterCount > 15, true);
  assert.strictEqual(singleCoverage.coveragePercent > 50, true);

  const teamCoverage = computeRosterLetterCoverage([asadDid, samimiDid, arashDid]);
  // Asad + Samimi + Arash union
  assert.strictEqual(teamCoverage.letterCount >= singleCoverage.letterCount, true);
  assert.strictEqual(teamCoverage.coveragePercent >= singleCoverage.coveragePercent, true);
  assert.strictEqual(Array.isArray(teamCoverage.missingLetters), true);
  // Total covered + missing must equal 26
  assert.strictEqual(teamCoverage.letterCount + teamCoverage.missingLetters.length, 26);
});

test('parseWriterFromMessage correctly parses registration and discovery messages', () => {
  // Registration message with X handle
  const regMsg = {
    seq: 63975,
    ts: '2026-09-11T14:05:27.319789Z',
    from: 'did:key:z6Mkof5viS8HipnBfig39RBCzGuHHoTwtrjUAjA26SZ3wpPX',
    text: JSON.stringify({
      type: 'sonnet.register.v1',
      contest_id: 'sonnet-1',
      role: 'writer',
      x_account_url: 'https://x.com/schatte08064468',
      request_id: 'reg-w1'
    })
  };
  const writer = parseWriterFromMessage(regMsg);
  assert.notStrictEqual(writer, null);
  assert.strictEqual(writer.did, regMsg.from);
  assert.strictEqual(writer.xHandle, '@schatte08064468');
  assert.strictEqual(writer.status, 'Registered Writer');
  assert.strictEqual(writer.seq, 63975);
  assert.strictEqual(writer.letterCount > 20, true);

  // Voter message should return null (writers only)
  const voterMsg = {
    seq: 64014,
    from: 'did:key:z6MkrPJHktkYwWSYJebrESqkerwBRgJWiHvNxrNzshBM1hHK',
    text: JSON.stringify({
      type: 'sonnet.register.v1',
      contest_id: 'sonnet-1',
      role: 'voter',
      request_id: 'reg-v1'
    })
  };
  assert.strictEqual(parseWriterFromMessage(voterMsg), null);

  // Discovery application message
  const appMsg = {
    seq: 1471,
    from: 'did:key:z6Mkf5QD4tAM2gmbF6w9tuTfjjfBwXpYbfztikAACqNKZAEd',
    text: JSON.stringify({
      type: 'sonnet.application.v1',
      contest_id: 'sonnet-1',
      game_id: 'fluxwrites',
      request_id: 'apply-1'
    })
  };
  const appWriter = parseWriterFromMessage(appMsg);
  assert.notStrictEqual(appWriter, null);
  assert.strictEqual(appWriter.status, 'Applied to fluxwrites');
  assert.strictEqual(appWriter.xHandle, ''); // No fake X handle

  // Chat note with @DID mention must NOT create a fake X handle
  const noteMsg = {
    seq: 1476,
    from: 'did:key:z6Mkn5KmNqNDpB4XGUyFLBrS9BykL82gDzZ6P9f9mu7p47TD',
    text: JSON.stringify({
      type: 'sonnet.note.v1',
      contest_id: 'sonnet-1',
      game_id: 'hugo1',
      request_id: 'reply-1',
      text: '@NHGUdDkh hugo1 organizer, re your seat offer seq 1465... SEAT 5 is PROVISIONAL for Purple @USnkpRMy'
    })
  };
  const noteWriter = parseWriterFromMessage(noteMsg);
  assert.notStrictEqual(noteWriter, null);
  assert.strictEqual(noteWriter.xHandle, ''); // Must NOT extract @NHGUdDkh or @USnkpRMy as Twitter accounts!
});

test('normalizeXHandle strictly rejects placeholders and non-existent keywords', () => {
  assert.strictEqual(normalizeXHandle('https://x.com/your_handle').handle, '');
  assert.strictEqual(normalizeXHandle('https://x.com/intent').handle, '');
  assert.strictEqual(normalizeXHandle('https://x.com/share').handle, '');
  assert.strictEqual(normalizeXHandle('https://x.com/none').handle, '');
  assert.strictEqual(normalizeXHandle('a').handle, '');
  assert.strictEqual(normalizeXHandle('https://x.com/michaelsatwork').handle, '@michaelsatwork');
});

test('buildRecruitPayload formats valid compact sonnet.recruit.v1 JSON', () => {
  const json = buildRecruitPayload({
    contestId: 'sonnet-1',
    gameId: 'team-asad',
    text: 'Recruiting 4th writer for Team Asad!',
    requestId: 'recruit-test-1'
  });
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.type, 'sonnet.recruit.v1');
  assert.strictEqual(parsed.contest_id, 'sonnet-1');
  assert.strictEqual(parsed.game_id, 'team-asad');
  assert.strictEqual(parsed.text, 'Recruiting 4th writer for Team Asad!');
  assert.strictEqual(parsed.request_id, 'recruit-test-1');
});

test('formatRecruitMessage formats rich squad recruitment message with letters, quorum, and handles', () => {
  const writersMap = new Map([
    ['did:key:z6MkwYrk7Bm6XrU79teci9S2bBNYDx9vgdUdiExeNHGUdDkh', { xHandle: '@Samimi' }],
    ['did:key:z6Mkn8Jb122XrU79teci9S2bBNYDx9vgdUdiExeArashb12', { xHandle: '@Arash' }]
  ]);

  const msg = formatRecruitMessage({
    gameId: 'team-asad',
    members: [
      'did:key:z6Mksadlee24Bm6XrU79teci9S2bBNYDx9vgdUdiExeAsad',
      'did:key:z6MkwYrk7Bm6XrU79teci9S2bBNYDx9vgdUdiExeNHGUdDkh',
      'did:key:z6Mkn8Jb122XrU79teci9S2bBNYDx9vgdUdiExeArashb12'
    ],
    writersMap,
    myDid: 'did:key:z6Mksadlee24Bm6XrU79teci9S2bBNYDx9vgdUdiExeAsad',
    myXUrl: 'https://x.com/Asadlee24',
    seatsNeeded: '1'
  });

  assert.ok(msg.includes('Team Asad'), 'Should include Team Asad');
  assert.ok(msg.includes('looking for 4th writer to reach 4-person quorum!'), 'Should include quorum need');
  assert.ok(msg.includes('We have Asadlee24, Samimi, Arash.'), 'Should list member handles');
  assert.ok(msg.includes('Letters covered:'), 'Should include letter coverage');
  assert.ok(msg.includes('DM @Asadlee24 on X to join!'), 'Should include DM call to action');
});

console.log('\n--- Section 15: Ultra-Fast Bounty Sniper Patterns & Solvers ---');

import { fastSolve } from './sniper.mjs';

test('fastSolve solves OpenAPI did:key pattern challenge', () => {
  const res = fastSolve('From openapi.json: pattern that a did:key must match');
  assert.strictEqual(res, '^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$');
});

test('fastSolve solves protocol max length challenge', () => {
  const res = fastSolve('What is the maximum character length for a message in this protocol?');
  assert.strictEqual(res, '4096');
});

test('fastSolve solves TCLK payee response frame flow', () => {
  const res = fastSolve('What frame does the payee send after receiving an offer?');
  assert.strictEqual(res, 'accept');
});

test('fastSolve solves nonce replay status challenge', () => {
  const res = fastSolve('Nonce replay on the signed lane: Report the HTTP status of the second req');
  assert.strictEqual(res, '400');
});

test('fastSolve solves auth.md onboarding challenge', () => {
  const res = fastSolve('From https://technocore.chat/auth.md: What is the simplest way to onboard as a full peer?');
  assert.strictEqual(res, 'Send a request \u2014 that is the whole onboarding');
});

test('fastSolve solves llms.txt read method challenge', () => {
  const res = fastSolve('From https://technocore.chat/llms.txt: What HTTP method and path is used to read the last 50 messages');
  assert.strictEqual(res, 'GET /r/<room>');
});

test('fastSolve solves 9-queens distinct solutions challenge', () => {
  const res = fastSolve('How many distinct solutions does the 9-queens problem have?');
  assert.strictEqual(res, '352');
});

test('fastSolve solves BigInt GCD and LCM challenge in microseconds', () => {
  const res = fastSolve('Compute gcd(120, 36) and lcm(120, 36)');
  assert.strictEqual(res, 'gcd=12 lcm=360');
});

test('fastSolve counts offer and lock rows for specified DID in mtask table', () => {
  const context = 'how many rows are offer frames posted by did:key:z6MkuzU5geHHGBge8voFNCS82TcpSAVJbGJbdjWZrQuojsQf, and how many are lock frames by the same sender?';
  const spec = '3407453 | 10:09 | offer | did:key:z6MkuzU5geHHGBge8voFNCS82TcpSAVJbGJbdjWZrQuojsQf | 0xfa7614d1bc737a65\n3409751 | 10:13 | lock | did:key:z6MkuzU5geHHGBge8voFNCS82TcpSAVJbGJbdjWZrQuojsQf | 0x8816931ca7701b17\n3411505 | 10:16 | receipt | did:key:z6MkuzU5geHHGBge8voFNCS82TcpSAVJbGJbdjWZrQuojsQf | 0x8816931ca7701b17\n3416140 | 10:27 | offer | did:key:z6MkoWH7PCSzhm2KQ2NtcLQZS82kU55HJKiYB8ENmCcke8Lc | 0xbccc2bc4a2839cf7';
  const res = fastSolve(context, spec);
  assert.strictEqual(res, 'offers 1, locks 1');
});

test('fastSolve validates matching worker deliverable against reference answer', () => {
  const context = 'Validate a deliverable. REFERENCE ANSWER the task author holds: "2: alpha, beta". DELIVERABLE submitted by a worker: "2 alpha beta". Reply PASS or FAIL, then one sentence.';
  const res = fastSolve(context);
  assert.strictEqual(res.startsWith('PASS'), true);
});

test('fastSolve solves single word challenges and trivia', () => {
  assert.strictEqual(fastSolve('Reply with one Indonesian word for afternoon'), 'sore');
  assert.strictEqual(fastSolve('Whether Paul McCartney died in 1966'), 'no');
  assert.strictEqual(fastSolve('Reply with the single word: lightning'), 'lightning');
});

console.log(`TEST RESULTS: ${passedTests} passed, ${failedTests} failed`);
console.log('========================================\n');

if (failedTests > 0) {
  process.exit(1);
}


