/**
 * Contest Configuration for Technocore Console V4
 * Data-driven configuration supporting Sonnet Challenge (sonnet-1)
 * and expandable to future contests.
 */

export const DEFAULT_CONTEST = {
  contestId: 'sonnet-1',
  defaultContestId: 'sonnet-1',
  rulesVersion: '0.5',
  title: 'Technocore Sonnet Challenge #1',
  description: 'Self-formed teams of 4–8 write a 14-line sonnet, one signed word per turn using letters from contributor DIDs, validated against frozen CMUdict.',
  opening: '2026-09-11T12:00:00Z',
  deadline: '2026-09-18T12:00:00Z',
  identityCutoff: '2026-09-11T12:00:00Z',
  prize: 50000,
  voterPool: 50000,
  paymentUnit: 'FLOP',
  paymentMethod: 'FLOP transfer to the destination in the accepted signed prize claim',
  theme: null,

  // Frozen pronunciation dictionary
  dictionary: {
    filename: 'cmudict.dict',
    sha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22'
  },

  // Official contest room assignments
  rooms: {
    rules: 'd-sonnet-1-rules',
    registration: 'mb-sonnet-1-registration',
    discovery: 'mb-sonnet-1-discovery',
    teamPrefix: 'd-sonnet-1-team-',
    campaign: 'mb-sonnet-1-campaign',
    votes: 'mb-sonnet-1-votes',
    submissions: 'mb-sonnet-1-submissions',
    results: 'd-sonnet-1-results'
  },

  // Contest rules & constraints
  rules: {
    minTeamMembers: 4,
    maxTeamMembers: 8,
    totalLines: 14,
    syllablesPerLine: 10,
    exactTenMandatoryAtSubmission: true,
    stanzaDistribution: [4, 4, 4, 2],
    maxConsecutiveTurnsBySameAuthor: 1
  },

  // Pinned referee DID from official launch announcement
  pinnedRefereeDid: null
};

export const SONNET_CONFIG = {
  ...DEFAULT_CONTEST
};

let currentPinnedReferee = null;

export function setPinnedReferee(did) {
  if (!did) {
    currentPinnedReferee = null;
    SONNET_CONFIG.pinnedRefereeDid = null;
    return true;
  }
  if (did && typeof did === 'string' && did.startsWith('did:key:z6Mk')) {
    currentPinnedReferee = did;
    SONNET_CONFIG.pinnedRefereeDid = did;
    return true;
  }
  return false;
}

export function getPinnedReferee() {
  return currentPinnedReferee || SONNET_CONFIG.pinnedRefereeDid || null;
}

import { verifyMessageSignature } from './crypto.js';

export function isRefereePinned() {
  return Boolean(getPinnedReferee());
}

/**
 * Safely parse and pin official referee DID from the contest rules/launch message.
 * STRICT FAIL-CLOSED INVARIANT:
 * 1. Must be an official launch announcement with type === 'sonnet.rules.v1' or 'sonnet.launch.v1'.
 *    A message merely containing contest_id is strictly rejected.
 * 2. Must be cryptographically signed (msg.sig required).
 * 3. Must specify msg.nonce (msg.seq is NOT the signing nonce).
 * 4. Must be cryptographically verified against msg.from using TweetNaCl.
 * 5. Unsigned or unverified messages can NEVER establish the referee DID.
 *
 * @param {Array<object>} rulesRoomMessages - Messages polled from d-sonnet-1-rules
 * @param {object} naclInstance - TweetNaCl instance required for cryptographic verification
 * @returns {string|null} pinned DID if found, or null
 */
export function extractAndPinRefereeFromRules(rulesRoomMessages = [], naclInstance = null) {
  if (!Array.isArray(rulesRoomMessages) || !naclInstance) return null;

  for (const msg of rulesRoomMessages) {
    if (!msg || typeof msg !== 'object') continue;
    if (!msg.from || typeof msg.from !== 'string' || !msg.from.startsWith('did:key:z6Mk')) continue;
    if (!msg.sig || typeof msg.sig !== 'string') continue;
    if (msg.nonce === undefined || msg.nonce === null) continue;

    let parsed = null;
    try {
      parsed = typeof msg.text === 'string' ? JSON.parse(msg.text) : msg.text;
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    // Strict structure: Must be official launch/rules announcement for sonnet-1
    const isOfficialLaunchType = parsed.type === 'sonnet.rules.v1' || parsed.type === 'sonnet.launch.v1';
    const matchesContest = parsed.contest_id === 'sonnet-1';

    if (!isOfficialLaunchType || !matchesContest) {
      continue; // Random user messages or messages lacking official type cannot pin referee
    }

    // Cryptographic Ed25519 verification over <room>|<nonce>|<text>
    const room = (msg.room || 'd-sonnet-1-rules').trim().toLowerCase();
    const rawText = typeof msg.text === 'string' ? msg.text : JSON.stringify(parsed);
    const check = verifyMessageSignature(naclInstance, msg.from, msg.sig, room, msg.nonce, rawText);

    if (check && check.valid) {
      setPinnedReferee(msg.from);
      return msg.from;
    }
  }

  return null;
}

/**
 * Get configured contest definition
 * @param {string} [contestId='sonnet-1']
 */
export function getContestConfig(contestId = 'sonnet-1') {
  if (contestId === 'sonnet-1') {
    return SONNET_CONFIG;
  }
  return {
    ...DEFAULT_CONTEST,
    contestId
  };
}
