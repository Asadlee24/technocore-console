/**
 * Technocore Sonnet Challenge Helper & Validator Module (V4)
 * Official contest mechanics, CMUdict syllable counter, DID letter checker,
 * single-line protocol message builders with strict anti-fabrication invariants.
 */

import { sha256Hex } from './crypto.js';
import { DEFAULT_CONTEST } from './contest-config.js';

// Word regex: 1–32 lowercase letters per Sonnet rules
const WORD_REGEX = /^[a-z]{1,32}$/;

// CMUdict vowels set for stress detection
const CMUDICT_VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'B', 'CH', 'D', 'DH',
  'EH', 'ER', 'EY', 'F', 'G', 'HH', 'IH', 'IY', 'JH', 'K',
  'L', 'M', 'N', 'NG', 'OW', 'OY', 'P', 'R', 'S', 'SH',
  'T', 'TH', 'UH', 'UW', 'V', 'W', 'Y', 'Z', 'ZH'
]);

let _lexicon = null;
let _lexiconLoadingPromise = null;

/**
 * Check if all letters of a word exist in the registered DID (case-insensitive).
 *
 * @param {string} didKey - Contributor's full did:key string
 * @param {string} word - Candidate word (punctuation stripped)
 * @returns {{ compatible: boolean, missingLetters: string[], didLetters: Set<string> }}
 */
export function checkDidLetterCompatibility(a, b) {
  let didKey, word;
  if (typeof a === 'string' && a.startsWith('did:key:')) {
    didKey = a;
    word = b;
  } else if (typeof b === 'string' && b.startsWith('did:key:')) {
    didKey = b;
    word = a;
  } else {
    didKey = a;
    word = b;
  }

  if (!didKey || typeof didKey !== 'string') {
    return { compatible: false, missingLetters: [], didLetters: new Set() };
  }
  if (!word || typeof word !== 'string') {
    return { compatible: true, missingLetters: [], didLetters: new Set() };
  }

  // Extract all unique letters [a-z] from DID
  const didLetters = new Set();
  const lowerDid = didKey.toLowerCase();
  for (let i = 0; i < lowerDid.length; i++) {
    const ch = lowerDid[i];
    if (ch >= 'a' && ch <= 'z') {
      didLetters.add(ch);
    }
  }

  // Extract all unique letters [a-z] from candidate word
  const lowerWord = word.toLowerCase().replace(/[^a-z]/g, '');
  const missingLetters = [];

  for (let i = 0; i < lowerWord.length; i++) {
    const ch = lowerWord[i];
    if (!didLetters.has(ch) && !missingLetters.includes(ch)) {
      missingLetters.push(ch);
    }
  }

  return {
    compatible: missingLetters.length === 0,
    missingLetters,
    didLetters
  };
}

/**
 * Parse raw CMUdict text into a Map of word -> maximum syllable count
 * Rule: charges largest listed count per word across variants
 *
 * @param {string} rawText - Uncompressed CMUdict plain text
 * @returns {Map<string, number>}
 */
export function parseCmudictLexicon(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('CMUdict text is required');
  }

  const counts = new Map();
  const lines = rawText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const commentSplit = line.split('#')[0].trim();
    if (!commentSplit || commentSplit.startsWith(';;;')) continue;

    const fields = commentSplit.split(/\s+/);
    if (!fields || fields.length < 2) continue;

    const rawWord = fields[0].replace(/\(\d+\)$/, '').toLowerCase();
    if (!WORD_REGEX.test(rawWord)) continue;

    let count = 0;
    for (let j = 1; j < fields.length; j++) {
      const phone = fields[j];
      const stress = phone.slice(-1);
      if (stress === '0' || stress === '1' || stress === '2') {
        count++;
      }
    }

    if (count > 0) {
      const existing = counts.get(rawWord) || 0;
      if (count > existing) {
        counts.set(rawWord, count);
      }
    }
  }

  if (counts.size === 0) {
    throw new Error('Dictionary contains no usable pronunciations');
  }

  return counts;
}

/**
 * Load and verify the frozen CMUdict dictionary
 * @param {string} [dictUrl='./cmudict.dict']
 * @returns {Promise<Map<string, number>>}
 */
export async function loadFrozenLexicon(dictUrl = './cmudict.dict') {
  if (_lexicon) return _lexicon;
  if (_lexiconLoadingPromise) return _lexiconLoadingPromise;

  _lexiconLoadingPromise = (async () => {
    const res = await fetch(dictUrl);
    if (!res.ok) {
      throw new Error(`Failed to load ${dictUrl}: HTTP ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Verify SHA-256 against frozen contest package hash
    const computedHash = await sha256Hex(bytes);
    if (computedHash.toLowerCase() !== DEFAULT_CONTEST.dictionary.sha256.toLowerCase()) {
      throw new Error(`CMUdict hash mismatch! Expected ${DEFAULT_CONTEST.dictionary.sha256}, got ${computedHash}`);
    }

    const text = new TextDecoder('utf-8').decode(bytes);
    _lexicon = parseCmudictLexicon(text);
    return _lexicon;
  })();

  return _lexiconLoadingPromise;
}

/**
 * Count syllables of a single word using loaded lexicon
 * @param {string} word
 * @param {Map<string, number>} [lexicon]
 * @returns {number|null} syllable count, or null if word not found
 */
export function countWordSyllables(word, lexicon = _lexicon) {
  if (!lexicon) return null;
  const cleanWord = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!cleanWord) return 0;
  const count = lexicon.get(cleanWord);
  return count !== undefined ? count : null;
}

/**
 * Validate a candidate word for turn proposal
 *
 * @param {string} activeDid
 * @param {string} word
 * @param {Map<string, number>} [lexicon]
 */
export function validateCandidateWord(a, b, lexicon = _lexicon) {
  let activeDid, word;
  if (typeof a === 'string' && a.startsWith('did:key:')) {
    activeDid = a;
    word = b;
  } else if (typeof b === 'string' && b.startsWith('did:key:')) {
    activeDid = b;
    word = a;
  } else {
    word = a;
    activeDid = b;
  }

  const cleanWord = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  const letterCheck = checkDidLetterCompatibility(activeDid, cleanWord);
  const syllables = countWordSyllables(cleanWord, lexicon);

  const inDictionary = syllables !== null && syllables > 0;
  const valid = letterCheck.compatible && inDictionary && cleanWord.length > 0;

  return {
    word: cleanWord,
    valid,
    compatible: letterCheck.compatible,
    didCompatible: letterCheck.compatible,
    missingLetters: letterCheck.missingLetters,
    inDictionary,
    syllables: syllables || 0,
    error: !cleanWord
      ? 'Empty word'
      : !letterCheck.compatible
      ? `Letters not in DID: ${letterCheck.missingLetters.join(', ')}`
      : !inDictionary
      ? 'Word not found in frozen CMUdict lexicon'
      : null
  };
}

/**
 * Validate poem lines into 14 lines x 10 syllables
 *
 * @param {string[]|string} poemInput - Array of 14 lines or multiline poem string
 * @param {Map<string, number>} [lexicon]
 * @param {boolean} [exactTen=false]
 */
export function validatePoemSyllables(poemInput = [], lexicon = _lexicon, exactTen = false) {
  let lines = [];
  if (Array.isArray(poemInput)) {
    lines = poemInput;
  } else if (typeof poemInput === 'string') {
    lines = poemInput.trim().replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '');
  }

  const errors = [];
  const syllablesPerLine = [];

  if (lines.length !== 14) {
    errors.push(`Expected 14 lines, got ${lines.length}`);
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const tokens = String(lines[i] || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      errors.push(`Line ${lineNum} is empty`);
      syllablesPerLine.push(0);
      continue;
    }

    let lineSyllables = 0;
    let lineError = null;

    for (const token of tokens) {
      const syl = countWordSyllables(token, lexicon);
      if (syl === null) {
        lineError = `Line ${lineNum}: Word "${token}" not found in CMUdict lexicon`;
        break;
      }
      lineSyllables += syl;
    }

    if (lineError) {
      errors.push(lineError);
      syllablesPerLine.push(lineSyllables);
    } else {
      if (lineSyllables > 10) {
        errors.push(`Line ${lineNum} has ${lineSyllables} syllables (maximum 10 allowed)`);
      } else if (exactTen && lineSyllables !== 10) {
        errors.push(`Line ${lineNum} has ${lineSyllables} syllables (exactly 10 required for submission)`);
      }
      syllablesPerLine.push(lineSyllables);
    }
  }

  const totalSyllables = syllablesPerLine.reduce((a, b) => a + b, 0);
  return {
    valid: errors.length === 0 && lines.length === 14,
    syllablesPerLine,
    totalSyllables,
    errors
  };
}

// ----------------------------------------------------
// Sonnet Protocol Message Builders (Single-Line JSON)
// Strictly enforced anti-fabrication invariants:
// Throws if required authoritative referee fields are missing.
// ----------------------------------------------------

/**
 * 1. Build Registration Payload
 */
export function buildRegistrationPayload({ role, xAccountUrl, requestId, contestId = 'sonnet-1' }) {
  const cleanRole = (role || 'writer').toLowerCase();
  if (cleanRole !== 'writer' && cleanRole !== 'voter' && cleanRole !== 'organizer') {
    throw new Error('role must be writer, voter, or organizer');
  }

  const payload = {
    type: 'sonnet.register.v1',
    contest_id: contestId,
    role: cleanRole
  };

  if (cleanRole === 'writer') {
    if (!xAccountUrl || !xAccountUrl.trim()) {
      throw new Error('Writer registration requires public X account URL');
    }
    payload.x_account_url = xAccountUrl.trim();
  }

  if (!requestId || !requestId.trim()) {
    throw new Error('request_id is required');
  }
  payload.request_id = requestId.trim();
  return JSON.stringify(payload);
}

/**
 * 2. Build Team Request Payload
 */
export function buildTeamRequestPayload({ gameId, requestId, contestId = 'sonnet-1' }) {
  const cleanGameId = (gameId || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(cleanGameId)) {
    throw new Error('game_id must be 1–16 lowercase letters, digits, hyphens or underscores, starting with letter or digit');
  }
  if (!requestId || !requestId.trim()) {
    throw new Error('request_id is required');
  }
  return JSON.stringify({
    type: 'sonnet.team-request.v1',
    contest_id: contestId,
    game_id: cleanGameId,
    request_id: requestId.trim()
  });
}

/**
 * 3. Build Roster Consent Payload
 * Requires referee-allocated poem room and room_generation.
 */
export function buildRosterPayload({ gameId, poemRoom, roomGeneration, members, requestId }) {
  if (!gameId || !gameId.trim()) throw new Error('game_id is required');
  if (!poemRoom || !poemRoom.trim()) throw new Error('poem_room must be assigned by referee (never guessed)');
  if (roomGeneration === undefined || roomGeneration === null || isNaN(roomGeneration) || roomGeneration < 0) {
    throw new Error('room_generation must be a non-negative integer from referee receipt');
  }
  if (!Array.isArray(members) || members.length < 4 || members.length > 8) {
    throw new Error('Roster requires between 4 and 8 writer DIDs');
  }
  if (!requestId || !requestId.trim()) throw new Error('request_id is required');

  return JSON.stringify({
    type: 'sonnet.roster.v1',
    game_id: gameId.trim(),
    poem_room: poemRoom.trim(),
    room_generation: Number(roomGeneration),
    members: members.map(m => m.trim()),
    request_id: requestId.trim()
  });
}

/**
 * 4. Build Roster Withdrawal Payload
 */
export function buildWithdrawalPayload({ gameId, poemRoom, roomGeneration, requestId }) {
  if (!gameId || !gameId.trim()) throw new Error('game_id is required');
  if (!poemRoom || !poemRoom.trim()) throw new Error('poem_room is required');
  if (roomGeneration === undefined || roomGeneration === null || isNaN(roomGeneration) || roomGeneration < 0) {
    throw new Error('room_generation must be a non-negative integer from referee receipt');
  }
  if (!requestId || !requestId.trim()) throw new Error('request_id is required');

  return JSON.stringify({
    type: 'sonnet.withdraw.v1',
    game_id: gameId.trim(),
    poem_room: poemRoom.trim(),
    room_generation: Number(roomGeneration),
    request_id: requestId.trim()
  });
}

/**
 * 5. Build Word Proposal Payload
 * Reads version, previous_state_hash, and room_generation authoritatively from referee receipt.
 * Strictly prohibits zero-filled hashes or invented fallbacks.
 */
export function buildWordProposalPayload({
  gameId,
  roomGeneration,
  version,
  previousStateHash,
  word,
  requestId,
  contestId = 'sonnet-1'
}) {
  if (!gameId || !gameId.trim()) throw new Error('game_id is required');
  if (roomGeneration === undefined || roomGeneration === null || isNaN(roomGeneration) || roomGeneration < 0) {
    throw new Error('room_generation must be a non-negative integer from referee receipt (never invented)');
  }
  if (version === undefined || version === null || isNaN(version) || version < 0) {
    throw new Error('version must be a non-negative integer from referee receipt (never invented)');
  }
  if (
    !previousStateHash ||
    typeof previousStateHash !== 'string' ||
    previousStateHash.length !== 64 ||
    previousStateHash === '0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    throw new Error('previous_state_hash must be a 64-character SHA-256 hash read from referee receipt (never invented or zero-filled)');
  }
  if (!word || !word.trim()) throw new Error('word is required');
  if (!requestId || !requestId.trim()) throw new Error('request_id is required');

  return JSON.stringify({
    type: 'sonnet.word.v1',
    contest_id: contestId,
    game_id: gameId.trim(),
    room_generation: Number(roomGeneration),
    version: Number(version),
    previous_state_hash: previousStateHash.trim().toLowerCase(),
    word: word.trim(),
    request_id: requestId.trim()
  });
}

/**
 * 6. Build Submission Payload
 * Requires frozen completed poem and authoritative final_version.
 */
export function buildSubmissionPayload({
  gameId,
  poemRoom,
  roomGeneration,
  finalVersion,
  poemSha256,
  xPostIds,
  requestId,
  contestId = 'sonnet-1'
}) {
  if (!gameId || !gameId.trim()) throw new Error('game_id is required');
  if (!poemRoom || !poemRoom.trim()) throw new Error('poem_room is required');
  if (roomGeneration === undefined || roomGeneration === null || isNaN(roomGeneration) || roomGeneration < 0) {
    throw new Error('room_generation must be a non-negative integer from referee receipt');
  }
  if (finalVersion === undefined || finalVersion === null || isNaN(finalVersion) || finalVersion < 1) {
    throw new Error('final_version must be a positive integer from referee receipt');
  }
  if (
    !poemSha256 ||
    typeof poemSha256 !== 'string' ||
    poemSha256.length !== 64 ||
    poemSha256 === '0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    throw new Error('poem_sha256 must be an exact 64-character hash of canonical poem (never zero-filled)');
  }
  if (!Array.isArray(xPostIds) || xPostIds.length === 0) {
    throw new Error('x_post_ids array with at least 1 post ID is required');
  }
  if (!requestId || !requestId.trim()) throw new Error('request_id is required');

  return JSON.stringify({
    type: 'sonnet.submit.v1',
    contest_id: contestId,
    game_id: gameId.trim(),
    poem_room: poemRoom.trim(),
    room_generation: Number(roomGeneration),
    final_version: Number(finalVersion),
    poem_sha256: poemSha256.trim().toLowerCase(),
    x_post_ids: xPostIds.map(x => String(x).trim()),
    request_id: requestId.trim()
  });
}

/**
 * 7. Build Public Ballot Payload
 */
export function buildBallotPayload({ voterDid, entryId, requestId, contestId = 'sonnet-1' }) {
  if (!voterDid || !voterDid.trim()) throw new Error('voter_did is required');
  if (!entryId || !entryId.trim()) throw new Error('entry_id is required (never guessed)');
  if (!requestId || !requestId.trim()) throw new Error('request_id is required');

  return JSON.stringify({
    type: 'sonnet.ballot.v1',
    contest_id: contestId,
    voter_did: voterDid.trim(),
    entry_id: entryId.trim(),
    request_id: requestId.trim()
  });
}

/**
 * 8. Build Prize Claim Payload
 */
export function buildClaimPayload({ contestId = 'sonnet-1', gameId, destination, requestId }) {
  if (!gameId || !gameId.trim()) throw new Error('game_id is required');
  if (!destination || !destination.trim()) throw new Error('Payment destination is required');
  if (!requestId || !requestId.trim()) throw new Error('request_id is required');

  return JSON.stringify({
    type: 'sonnet.claim.v1',
    contest_id: contestId,
    game_id: gameId.trim(),
    destination: destination.trim(),
    request_id: requestId.trim()
  });
}

// ----------------------------------------------------
// Positional / Named Convenience Aliases for app.js
// ----------------------------------------------------

export function buildSonnetRegisterPayload(contestId, role, xAccountUrl, requestId) {
  return buildRegistrationPayload({ contestId, role, xAccountUrl, requestId });
}

export function buildSonnetTeamRequestPayload(contestId, gameId, requestId) {
  return buildTeamRequestPayload({ contestId, gameId, requestId });
}

export function buildSonnetRosterPayload(gameId, poemRoom, roomGeneration, members, requestId) {
  return buildRosterPayload({ gameId, poemRoom, roomGeneration, members, requestId });
}

export function buildSonnetWithdrawPayload(gameId, poemRoom, roomGeneration, requestId) {
  return buildWithdrawalPayload({ gameId, poemRoom, roomGeneration, requestId });
}

export function buildSonnetWordPayload(contestId, gameId, roomGeneration, version, previousStateHash, word, requestId) {
  return buildWordProposalPayload({ contestId, gameId, roomGeneration, version, previousStateHash, word, requestId });
}

export function buildSonnetSubmitPayload(contestId, gameId, poemRoom, roomGeneration, finalVersion, poemSha256, xPostIds, requestId) {
  return buildSubmissionPayload({ contestId, gameId, poemRoom, roomGeneration, finalVersion, poemSha256, xPostIds, requestId });
}

export function buildSonnetBallotPayload(contestId, voterDid, entryId, requestId) {
  return buildBallotPayload({ contestId, voterDid, entryId, requestId });
}

export function buildSonnetClaimPayload(contestId, gameId, destination, requestId) {
  return buildClaimPayload({ contestId, gameId, destination, requestId });
}

// ----------------------------------------------------
// Squad Board & Letter Coverage Utilities
// ----------------------------------------------------

/**
 * Extract all unique lowercase letters [a-z] from a DID string
 * @param {string} didKey
 * @returns {Set<string>}
 */
export function extractDidLetters(didKey) {
  const letters = new Set();
  if (!didKey || typeof didKey !== 'string') return letters;
  const lower = didKey.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch >= 'a' && ch <= 'z') {
      letters.add(ch);
    }
  }
  return letters;
}

/**
 * Compute aggregate letter coverage across an array of DIDs
 * @param {string[]} didList
 * @returns {{ letters: string[], letterCount: number, missingLetters: string[], coveragePercent: number, hasAllVowels: boolean, missingVowels: string[] }}
 */
export function computeRosterLetterCoverage(didList = []) {
  const unionSet = new Set();
  const validDids = (Array.isArray(didList) ? didList : []).filter(d => typeof d === 'string' && d.startsWith('did:key:'));
  
  for (const did of validDids) {
    const letters = extractDidLetters(did);
    for (const l of letters) {
      unionSet.add(l);
    }
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  const coveredLetters = alphabet.filter(l => unionSet.has(l));
  const missingLetters = alphabet.filter(l => !unionSet.has(l));
  const missingVowels = vowels.filter(v => !unionSet.has(v));

  return {
    letters: coveredLetters,
    letterCount: coveredLetters.length,
    missingLetters,
    coveragePercent: Math.round((coveredLetters.length / 26) * 100),
    hasAllVowels: missingVowels.length === 0,
    missingVowels
  };
}

const RESERVED_X_HANDLES = new Set([
  'your_handle', 'username', 'handle', 'twitter', 'x', 'none', 'null', 'undefined',
  'example', 'test', 'status', 'account', 'intent', 'share', 'post', 'url', 'home',
  'explore', 'search', 'hashtag', 'login', 'signup', 'tos', 'privacy', 'about', 'help'
]);

/**
 * Clean and normalize an X (Twitter) handle or URL
 * @param {string} raw
 * @returns {{ handle: string, url: string }}
 */
export function normalizeXHandle(raw) {
  if (!raw || typeof raw !== 'string') return { handle: '', url: '' };
  const cleaned = raw.trim()
    .replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0];
  if (!cleaned || cleaned.length < 3 || cleaned.length > 25) return { handle: '', url: '' };
  if (RESERVED_X_HANDLES.has(cleaned.toLowerCase())) return { handle: '', url: '' };
  if (!/^[a-zA-Z0-9_]{3,25}$/.test(cleaned)) return { handle: '', url: '' };
  return {
    handle: '@' + cleaned,
    url: `https://x.com/${cleaned}`
  };
}

/**
 * Extract writer details from a registration or discovery message
 * @param {object} msg
 * @returns {object|null}
 */
export function parseWriterFromMessage(msg) {
  if (!msg || !msg.from || !msg.from.startsWith('did:key:')) return null;
  const did = msg.from;
  const text = msg.text || '';
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  let role = 'writer';
  let xAccountUrl = '';
  let status = 'Active Participant';
  let isCandidateWriter = false;

  if (payload && typeof payload === 'object') {
    if (payload.type === 'sonnet.register.v1') {
      if (payload.role === 'writer') {
        isCandidateWriter = true;
        status = 'Registered Writer';
      } else if (payload.role === 'voter') {
        return null;
      }
      if (payload.x_account_url) {
        xAccountUrl = payload.x_account_url;
      }
    } else if (payload.type === 'sonnet.application.v1') {
      isCandidateWriter = true;
      status = payload.game_id ? `Applied to ${payload.game_id}` : 'Free Agent / Looking for Squad';
    } else if (payload.type === 'sonnet.recruit.v1') {
      isCandidateWriter = true;
      status = `Recruiting for ${payload.game_id || 'Team'}`;
    } else if (payload.type === 'sonnet.roster.v1') {
      isCandidateWriter = true;
      status = `Team Roster (${payload.game_id || 'Active'})`;
    } else if (payload.type === 'sonnet.note.v1') {
      isCandidateWriter = true;
      status = 'Active in Discovery';
    }
  }

  // Look for explicit X URL in text (e.g. https://x.com/username)
  // Strictly requires x.com or twitter.com domain to avoid capturing chat mentions of DID snippets
  if (!xAccountUrl && text) {
    const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{3,25})/i);
    if (urlMatch && urlMatch[1]) {
      xAccountUrl = urlMatch[1];
    }
  }

  let { handle, url } = normalizeXHandle(xAccountUrl);

  // Invariant: DID hashes must never be treated as X accounts
  if (handle && did.toLowerCase().endsWith(handle.slice(1).toLowerCase())) {
    handle = '';
    url = '';
  }

  if (!isCandidateWriter && !handle) return null;

  const didLettersSet = extractDidLetters(did);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  const letters = alphabet.filter(l => didLettersSet.has(l));
  const missingLetters = alphabet.filter(l => !didLettersSet.has(l));
  const writerVowels = vowels.filter(v => didLettersSet.has(v));

  return {
    did,
    xHandle: handle,
    xUrl: url,
    role,
    status,
    seq: msg.seq || null,
    ts: msg.ts || null,
    letters,
    letterCount: letters.length,
    missingLetters,
    vowels: writerVowels,
    hasAllVowels: writerVowels.length === 5
  };
}

