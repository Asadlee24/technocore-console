/**
 * Sonnet Challenge Core Logic and Validation Engine for Technocore Console V4
 * Implements candidate word checks, frozen CMUdict syllable calculations,
 * poem state maintenance, and protocol message builders matching official rules.
 */

import { DEFAULT_CONTEST } from './contest-config.js';
import { sha256Hex, formatCanonicalPoem, computePoemSha256 } from './protocol.js';

// Restrict spelling grammar per official sonnet_validate.py
export const WORD_REGEX = /^[A-Za-z]+(?:'[A-Za-z]+)*$/;
export const TOKEN_REGEX = /^([A-Za-z]+(?:'[A-Za-z]+)*)[,.;:!?]?$/;
export const ED25519_DID_REGEX = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
export const CMUDICT_VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

// In-memory syllable lexicon map
let _lexicon = null;
let _lexiconHash = null;
let _lexiconLoadingPromise = null;

/**
 * Check a candidate word against an authenticated DID's characters locally.
 * Rule: Every alphabetic letter in the word must exist somewhere in the DID string (case-insensitive).
 * Letters may be reused unlimited times. Optional single trailing punctuation [,.;:!?] allowed.
 *
 * @param {string} token - Candidate word with optional allowed trailing punctuation
 * @param {string} did - Contributor's exact registered did:key
 * @returns {{
 *   compatible: boolean,
 *   cleanWord: string,
 *   allowedLetters: string[],
 *   missingLetters: string[],
 *   error?: string
 * }}
 */
export function checkDidLetterCompatibility(token, did) {
  if (!token || typeof token !== 'string') {
    return { compatible: false, cleanWord: '', allowedLetters: [], missingLetters: [], error: 'Word cannot be empty' };
  }

  const match = token.trim().match(TOKEN_REGEX);
  if (!match) {
    return {
      compatible: false,
      cleanWord: token,
      allowedLetters: [],
      missingLetters: [],
      error: 'Invalid word format. Must be one English word with optional allowed punctuation (, . ; : ! ?)'
    };
  }

  const cleanWord = match[1].toLowerCase();

  if (!did || typeof did !== 'string' || !ED25519_DID_REGEX.test(did.trim())) {
    return {
      compatible: false,
      cleanWord,
      allowedLetters: [],
      missingLetters: [],
      error: 'Invalid or missing Ed25519 did:key'
    };
  }

  // Letters in DID (case-insensitive, includes 'did:key:z6mk...')
  const allowedSet = new Set();
  for (const ch of did.trim().toLowerCase()) {
    if (ch >= 'a' && ch <= 'z') allowedSet.add(ch);
  }

  // Letters in word token
  const missingSet = new Set();
  for (const ch of cleanWord) {
    if (ch >= 'a' && ch <= 'z') {
      if (!allowedSet.has(ch)) {
        missingSet.add(ch);
      }
    }
  }

  const missingLetters = Array.from(missingSet).sort();
  const compatible = missingLetters.length === 0;

  return {
    compatible,
    cleanWord,
    allowedLetters: Array.from(allowedSet).sort(),
    missingLetters,
    error: compatible ? undefined : `Letters absent from contributor DID: ${missingLetters.join(', ')}`
  };
}

/**
 * Parse CMUdict plaintext into word -> max syllable count map
 * Charges largest listed syllable count per word.
 *
 * @param {string} rawText
 * @returns {Map<string, number>}
 */
export function parseCmudictLexicon(rawText) {
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
      const phoneme = phone.slice(0, -1);
      const stress = phone.slice(-1);
      if (CMUDICT_VOWELS.has(phoneme) && (stress === '0' || stress === '1' || stress === '2')) {
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

    _lexiconHash = computedHash;
    const text = new TextDecoder('utf-8').decode(bytes);
    _lexicon = parseCmudictLexicon(text);
    return _lexicon;
  })();

  return _lexiconLoadingPromise;
}

/**
 * Check syllables for one word token using loaded lexicon
 *
 * @param {string} token
 * @param {Map<string, number>} lexicon
 * @returns {number}
 */
export function countWordSyllables(token, lexicon) {
  if (!token || typeof token !== 'string') {
    throw new Error('Expected word token string');
  }
  const match = token.trim().match(TOKEN_REGEX);
  if (!match) {
    throw new Error(`Invalid token format: "${token}"`);
  }
  const word = match[1].toLowerCase();
  if (!lexicon.has(word)) {
    throw new Error(`Word "${word}" is not in the frozen dictionary`);
  }
  return lexicon.get(word);
}

/**
 * Validate a candidate word against DID letters AND frozen lexicon
 *
 * @param {string} token
 * @param {string} did
 * @param {Map<string, number>} lexicon
 * @returns {{
 *   valid: boolean,
 *   cleanWord: string,
 *   syllables: number,
 *   compatible: boolean,
 *   inDictionary: boolean,
 *   error?: string
 * }}
 */
export function validateCandidateWord(token, did, lexicon) {
  const didCheck = checkDidLetterCompatibility(token, did);
  if (!didCheck.compatible) {
    return {
      valid: false,
      cleanWord: didCheck.cleanWord,
      syllables: 0,
      compatible: false,
      inDictionary: false,
      error: didCheck.error
    };
  }

  try {
    const syllables = countWordSyllables(token, lexicon);
    if (syllables < 1 || syllables > 10) {
      return {
        valid: false,
        cleanWord: didCheck.cleanWord,
        syllables,
        compatible: true,
        inDictionary: true,
        error: `Word has ${syllables} syllables, exceeding the 10-syllable line limit`
      };
    }

    return {
      valid: true,
      cleanWord: didCheck.cleanWord,
      syllables,
      compatible: true,
      inDictionary: true
    };
  } catch (err) {
    return {
      valid: false,
      cleanWord: didCheck.cleanWord,
      syllables: 0,
      compatible: true,
      inDictionary: false,
      error: err.message
    };
  }
}

/**
 * Validate full 14-line poem syllables against frozen lexicon
 *
 * @param {string|string[]} poemInput - 14 lines or text
 * @param {Map<string, number>} lexicon
 * @param {boolean} [exactTen=false]
 * @returns {{
 *   valid: boolean,
 *   syllablesPerLine: number[],
 *   totalSyllables: number,
 *   errors: string[]
 * }}
 */
export function validatePoemSyllables(poemInput, lexicon, exactTen = false) {
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
    const tokens = lines[i].trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      errors.push(`Line ${lineNum} is empty`);
      syllablesPerLine.push(0);
      continue;
    }

    let lineSyllables = 0;
    let lineError = null;

    for (const token of tokens) {
      try {
        lineSyllables += countWordSyllables(token, lexicon);
      } catch (err) {
        lineError = `Line ${lineNum}: ${err.message}`;
        break;
      }
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
// ----------------------------------------------------

/**
 * 1. Build Registration Payload
 * @param {object} params
 * @param {string} params.role - 'writer' | 'voter' | 'organizer'
 * @param {string} [params.xAccountUrl] - required for writer
 * @param {string} params.requestId
 * @param {string} [params.contestId='sonnet-1']
 */
export function buildRegistrationPayload({ role, xAccountUrl, requestId, contestId = 'sonnet-1' }) {
  const cleanRole = (role || 'writer').toLowerCase();
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
  payload.request_id = requestId || `reg-${Date.now()}`;
  return JSON.stringify(payload);
}

/**
 * 2. Build Team Request Payload
 * @param {object} params
 * @param {string} params.gameId - 1-16 chars /^[a-z0-9][a-z0-9_-]{0,15}$/
 * @param {string} params.requestId
 * @param {string} [params.contestId='sonnet-1']
 */
export function buildTeamRequestPayload({ gameId, requestId, contestId = 'sonnet-1' }) {
  const cleanGameId = (gameId || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,15}$/.test(cleanGameId)) {
    throw new Error('game_id must be 1–16 lowercase letters, digits, hyphens or underscores, starting with letter or digit');
  }
  return JSON.stringify({
    type: 'sonnet.team-request.v1',
    contest_id: contestId,
    game_id: cleanGameId,
    request_id: requestId || `team-req-${Date.now()}`
  });
}

/**
 * 3. Build Roster Consent Payload
 * @param {object} params
 * @param {string} params.gameId
 * @param {string} params.poemRoom
 * @param {number} params.roomGeneration
 * @param {string[]} params.members - 4 to 8 writer DIDs
 * @param {string} params.requestId
 */
export function buildRosterPayload({ gameId, poemRoom, roomGeneration, members, requestId }) {
  if (!Array.isArray(members) || members.length < 4 || members.length > 8) {
    throw new Error('Roster requires between 4 and 8 writer DIDs');
  }
  return JSON.stringify({
    type: 'sonnet.roster.v1',
    game_id: gameId,
    poem_room: poemRoom,
    room_generation: Number(roomGeneration),
    members: members.map(m => m.trim()),
    request_id: requestId || `roster-${Date.now()}`
  });
}

/**
 * 4. Build Roster Withdrawal Payload
 * @param {object} params
 * @param {string} params.gameId
 * @param {string} params.requestId
 */
export function buildWithdrawalPayload({ gameId, requestId }) {
  return JSON.stringify({
    type: 'sonnet.withdraw.v1',
    game_id: gameId,
    request_id: requestId || `withdraw-${Date.now()}`
  });
}

/**
 * 5. Build Word Proposal Payload
 * Reads version, previous_state_hash, and room_generation authoritatively from referee receipt.
 *
 * @param {object} params
 * @param {string} params.gameId
 * @param {number} params.roomGeneration
 * @param {number} params.version
 * @param {string} params.previousStateHash
 * @param {string} params.word
 * @param {string} params.requestId
 * @param {string} [params.contestId='sonnet-1']
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
  if (!word || !word.trim()) throw new Error('Word is required');
  if (previousStateHash === undefined || previousStateHash === null) {
    throw new Error('previous_state_hash must be read from referee receipt (never invented)');
  }
  return JSON.stringify({
    type: 'sonnet.word.v1',
    contest_id: contestId,
    game_id: gameId,
    room_generation: Number(roomGeneration),
    version: Number(version),
    previous_state_hash: previousStateHash,
    word: word.trim(),
    request_id: requestId || `word-${version}-${Date.now()}`
  });
}

/**
 * 6. Build Submission Payload
 * @param {object} params
 * @param {string} params.gameId
 * @param {string} params.poemRoom
 * @param {number} params.roomGeneration
 * @param {number} params.finalVersion
 * @param {string} params.poemSha256
 * @param {string[]} params.xPostIds
 * @param {string} params.requestId
 * @param {string} [params.contestId='sonnet-1']
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
  if (!poemSha256) throw new Error('poem_sha256 is required');
  if (!Array.isArray(xPostIds) || xPostIds.length === 0) {
    throw new Error('x_post_ids array with at least 1 post ID is required');
  }
  return JSON.stringify({
    type: 'sonnet.submit.v1',
    contest_id: contestId,
    game_id: gameId,
    poem_room: poemRoom,
    room_generation: Number(roomGeneration),
    final_version: Number(finalVersion),
    poem_sha256: poemSha256,
    x_post_ids: xPostIds,
    request_id: requestId || `submit-${Date.now()}`
  });
}

/**
 * 7. Build Public Ballot Payload
 * @param {object} params
 * @param {string} params.voterDid
 * @param {string} params.entryId
 * @param {string} params.requestId
 * @param {string} [params.contestId='sonnet-1']
 */
export function buildBallotPayload({ voterDid, entryId, requestId, contestId = 'sonnet-1' }) {
  if (!voterDid || !entryId) throw new Error('voter_did and entry_id are required');
  return JSON.stringify({
    type: 'sonnet.ballot.v1',
    contest_id: contestId,
    voter_did: voterDid.trim(),
    entry_id: entryId.trim(),
    request_id: requestId || `ballot-${Date.now()}`
  });
}

/**
 * 8. Build Prize Claim Payload
 * @param {object} params
 * @param {string} params.destination - payment destination (e.g. FLOP wallet)
 * @param {string} params.requestId
 * @param {string} [params.contestId='sonnet-1']
 */
export function buildClaimPayload({ destination, requestId, contestId = 'sonnet-1' }) {
  if (!destination || !destination.trim()) throw new Error('Payment destination is required');
  return JSON.stringify({
    type: 'sonnet.claim.v1',
    contest_id: contestId,
    destination: destination.trim(),
    request_id: requestId || `claim-${Date.now()}`
  });
}
