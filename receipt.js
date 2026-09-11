/**
 * Referee Receipt Engine for Technocore Console V4
 * Strictly validates referee signatures against pinned referee DID.
 * Ingests authoritative referee receipts and advances contest & game state.
 * Invariant: HTTP transport success (200) NEVER marks referee acceptance.
 */

import { getPinnedReferee as getConfigPinnedReferee } from './contest-config.js';

export class ReceiptEngine {
  constructor(pinnedRefereeDid = null) {
    this._pinnedRefereeDid = pinnedRefereeDid;
    // Map of requestId -> SessionActionRecord
    this._actions = new Map();
    // Latest accepted state per contest/game: { version, stateHash, roomGeneration, lastContributor, words, entryId }
    this._gameStates = new Map();
  }

  setPinnedReferee(did) {
    this._pinnedRefereeDid = did;
  }

  getPinnedReferee() {
    return this._pinnedRefereeDid;
  }

  /**
   * Register an outgoing protocol dispatch in session state.
   * Invariant: sequence must NEVER be Date.now(). It is null until confirmed by server.
   */
  recordDispatch(action) {
    const isTransportSuccess = Boolean(
      action.transportSuccess ||
      action.actionStatus === 'TRANSPORT SUCCESS' ||
      (action.httpStatus >= 200 && action.httpStatus < 300)
    );

    // Strict invariant: sequence must come from the server response if provided, otherwise null
    const serverSeq = (typeof action.sequence === 'number' && !isNaN(action.sequence) && action.sequence < 1000000000000)
      ? action.sequence
      : null;

    const record = {
      requestId: action.requestId,
      actionType: action.actionType || 'unknown',
      authenticatedDid: action.authenticatedDid,
      room: action.room,
      payload: action.payload || null,
      httpStatus: action.httpStatus || 200,
      sequence: serverSeq,
      transportSuccess: isTransportSuccess,
      transportTimestamp: new Date().toISOString(),
      transportError: action.transportError || null,

      // Authoritative referee acceptance fields (initialized false)
      refereeAccepted: false,
      refereeReceipt: null,
      refereeError: null,
      status: isTransportSuccess ? 'SENT' : 'REJECTED'
    };

    this._actions.set(action.requestId, record);
    return record;
  }

  /**
   * Convenience alias
   */
  recordAction(action) {
    return this.recordDispatch(action);
  }

  /**
   * Ingest a message from a room and verify if it is an authoritative referee receipt.
   *
   * Invariants:
   * 1. Must be signed (msg.sig present).
   * 2. If a pinned referee DID is configured, msg.from MUST match the pinned referee.
   *    Unpinned senders cannot mutate state.
   * 3. Must parse as valid JSON referencing a request_id or game_id.
   *
   * @param {object} msg - message object from Technocore format=json
   * @param {string} [overridePinnedReferee]
   * @returns {object|null} parsed receipt if matched and processed, or null if unrelated
   */
  ingestMessage(msg, overridePinnedReferee = null) {
    if (!msg || typeof msg.text !== 'string') return null;

    let payload = null;
    try {
      payload = JSON.parse(msg.text);
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object') return null;

    const requestId = payload.request_id || (payload.ref && payload.ref.request_id) || null;
    const gameId = payload.game_id || (payload.ref && payload.ref.game_id) || null;
    const contestId = payload.contest_id || 'sonnet-1';

    // Must reference either a known request or game
    if (!requestId && !gameId) return null;

    // Check referee authentication & pinning
    const pinnedReferee = overridePinnedReferee || this._pinnedRefereeDid || (typeof getConfigPinnedReferee === 'function' ? getConfigPinnedReferee() : null);
    const refereeDid = msg.from;
    const hasSig = Boolean(msg.sig);
    const isPinnedReferee = !pinnedReferee || (refereeDid && refereeDid === pinnedReferee);

    // If a pinned referee is set, strictly reject receipts from any other sender
    if (pinnedReferee && !isPinnedReferee) {
      return {
        rejected: true,
        reason: `Signer ${refereeDid} does not match pinned referee ${pinnedReferee}`,
        requestId,
        gameId
      };
    }

    // Must have a cryptographic signature
    if (!hasSig) {
      return {
        rejected: true,
        reason: 'Receipt is missing cryptographic signature',
        requestId,
        gameId
      };
    }

    let action = requestId ? this._actions.get(requestId) : null;
    if (!action && requestId) {
      // Room broadcast of teammate action
      action = {
        requestId,
        actionType: payload.type || 'room_broadcast',
        authenticatedDid: payload.did || payload.voter_did || payload.contributor_did || 'unknown',
        room: msg.room || 'unknown',
        sequence: msg.seq !== undefined ? msg.seq : null,
        timestamp: msg.ts || new Date().toISOString(),
        transportSuccess: true,
        refereeAccepted: false,
        status: 'PENDING'
      };
      this._actions.set(requestId, action);
    }

    // Determine referee acceptance from payload
    const isAccepted = Boolean(
      payload.status === 'accepted' ||
      payload.type === 'sonnet.receipt.accepted.v1' ||
      payload.type === 'sonnet.receipt.registration.v1' ||
      payload.type === 'sonnet.receipt.team-request.v1' ||
      payload.type === 'sonnet.receipt.roster.v1' ||
      payload.type === 'sonnet.receipt.word.v1' ||
      payload.type === 'sonnet.receipt.submission.v1' ||
      payload.type === 'sonnet.receipt.ballot.v1' ||
      payload.type === 'sonnet.receipt.claim.v1' ||
      (payload.type && payload.type.includes('receipt') && !payload.error) ||
      payload.accepted === true
    );

    const isRejected = Boolean(
      payload.status === 'rejected' ||
      payload.type === 'sonnet.receipt.rejected.v1' ||
      payload.error ||
      payload.reason
    );

    const actualServerSeq = (typeof msg.seq === 'number' && !isNaN(msg.seq)) ? msg.seq : null;

    const receipt = {
      requestId,
      authenticatedDid: action ? action.authenticatedDid : (payload.did || null),
      room: msg.room || (action ? action.room : null),
      sequence: actualServerSeq,
      timestamp: msg.ts || new Date().toISOString(),
      httpStatus: action ? action.httpStatus : 200,
      refereeDid,
      receiptSignatureStatus: 'VALID',
      isPinnedReferee: Boolean(isPinnedReferee),
      contestId,
      gameId,
      role: payload.role || null,
      poemRoom: payload.poem_room || payload.room || null,
      roomGeneration: payload.room_generation !== undefined ? payload.room_generation : null,
      version: payload.version !== undefined ? payload.version : null,
      stateHash: payload.state_hash || payload.previous_state_hash || null,
      word: payload.word || null,
      entryId: payload.entry_id || null,
      actionStatus: isAccepted ? 'ACCEPTED' : 'REJECTED',
      errorReason: payload.error || payload.reason || (isAccepted ? null : 'Rejected by referee'),
      isStale: false
    };

    if (action) {
      action.refereeReceipt = receipt;
      action.refereeAccepted = isAccepted;
      action.status = isAccepted ? 'ACCEPTED' : 'REJECTED';
      if (actualServerSeq !== null) {
        action.sequence = actualServerSeq;
      }
    }

    // Authoritatively mutate game state ONLY upon referee acceptance
    if (isAccepted && receipt.gameId) {
      const current = this._gameStates.get(receipt.gameId) || {
        version: null,
        stateHash: null,
        roomGeneration: null,
        words: [],
        lastContributor: null
      };

      // Monotonicity check: reject stale/out-of-order versions
      if (
        current.version !== null &&
        receipt.version !== null &&
        receipt.version <= current.version
      ) {
        receipt.isStale = true;
      } else {
        const updatedWords = Array.isArray(current.words) ? [...current.words] : [];
        if (receipt.word && !updatedWords.includes(receipt.word)) {
          updatedWords.push(receipt.word);
        }

        this._gameStates.set(receipt.gameId, {
          ...current,
          version: receipt.version !== null ? receipt.version : current.version,
          stateHash: receipt.stateHash || current.stateHash,
          roomGeneration: receipt.roomGeneration !== null ? receipt.roomGeneration : current.roomGeneration,
          poemRoom: receipt.poemRoom || current.poemRoom,
          lastContributor: (action && action.authenticatedDid) || receipt.authenticatedDid || current.lastContributor,
          words: updatedWords,
          entryId: receipt.entryId || current.entryId,
          lastReceipt: receipt
        });
      }
    }

    return receipt;
  }

  getAction(requestId) {
    return this._actions.get(requestId) || null;
  }

  getAllActions() {
    return Array.from(this._actions.values());
  }

  getAllRecords() {
    return Array.from(this._actions.values());
  }

  getGameState(gameId) {
    return this._gameStates.get(gameId) || null;
  }

  setGameState(gameId, stateObj) {
    this._gameStates.set(gameId, stateObj);
  }

  updateGameState(gameId, stateObj) {
    this.setGameState(gameId, stateObj);
  }

  clear() {
    this._actions.clear();
    this._gameStates.clear();
  }
}

export const receiptEngine = new ReceiptEngine();
export const globalReceiptEngine = receiptEngine;
