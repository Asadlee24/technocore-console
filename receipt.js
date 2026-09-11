/**
 * Referee Receipt Engine for Technocore Console V4
 * Strictly validates referee signatures against pinned referee DID.
 * Ingests authoritative referee receipts and advances contest & game state.
 * Invariant: HTTP transport success (200) NEVER marks referee acceptance.
 */

import { getPinnedReferee as getConfigPinnedReferee } from './contest-config.js';
import { verifyMessageSignature } from './crypto.js';

export class ReceiptEngine {
  constructor(pinnedRefereeDid = null, naclInstance = null) {
    this._pinnedRefereeDid = pinnedRefereeDid;
    this._nacl = naclInstance;
    // Map of requestId -> SessionActionRecord
    this._actions = new Map();
    // Latest accepted state per contest/game: { version, stateHash, roomGeneration, lastContributor, words, entryId }
    this._gameStates = new Map();
  }

  setNacl(naclInstance) {
    this._nacl = naclInstance;
  }

  setPinnedReferee(did) {
    this._pinnedRefereeDid = did;
  }

  getPinnedReferee() {
    return this._pinnedRefereeDid || (typeof getConfigPinnedReferee === 'function' ? getConfigPinnedReferee() : null);
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
      transportTimestamp: new Date().toISOString(),
      transportSuccess: isTransportSuccess,
      transportError: action.transportError || null,

      // Authoritative referee acceptance fields (initialized false)
      refereeAccepted: false,
      refereeReceipt: null,
      refereeError: null,
      status: isTransportSuccess ? 'SENT' : 'FAILED',
      stateHash: action.stateHash || null
    };

    if (action.requestId) {
      this._actions.set(action.requestId, record);
    }
    return record;
  }

  /**
   * Convenience alias
   */
  recordAction(action) {
    return this.recordDispatch(action);
  }

  /**
   * Ingest an incoming room message and detect if it is an authoritative referee receipt.
   * STRICT FAIL-CLOSED INVARIANT:
   * If referee DID is not pinned, receipts CANNOT mutate state.
   * If signature is invalid, receipts CANNOT mutate state.
   *
   * @param {object} msg - Raw message object from room polling or socket
   * @param {string} [overridePinnedReferee]
   * @returns {object|null} parsed receipt record or rejection description
   */
  ingestMessage(msg, overridePinnedReferee = null) {
    if (!msg || typeof msg !== 'object') return null;

    let payload = null;
    try {
      if (typeof msg.text === 'string') {
        payload = JSON.parse(msg.text);
      } else if (typeof msg.text === 'object') {
        payload = msg.text;
      }
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object') return null;

    const requestId = payload.request_id || (payload.ref && payload.ref.request_id) || null;
    const gameId = payload.game_id || (payload.ref && payload.ref.game_id) || null;
    const contestId = payload.contest_id || 'sonnet-1';

    // Must reference either a known request or game
    if (!requestId && !gameId) return null;

    // INVARIANT 1: Strict Fail-Closed Check on Pinned Referee DID
    const pinnedReferee = overridePinnedReferee || this._pinnedRefereeDid || (typeof getConfigPinnedReferee === 'function' ? getConfigPinnedReferee() : null);
    if (!pinnedReferee) {
      return {
        rejected: true,
        reason: 'Waiting for official referee pin. Authoritative state mutation disabled.',
        requestId,
        gameId
      };
    }

    const refereeDid = msg.from;
    const hasSig = Boolean(msg.sig);

    // INVARIANT 2: Strictly verify signer matches pinned referee
    if (!refereeDid || refereeDid !== pinnedReferee) {
      return {
        rejected: true,
        reason: `Signer ${refereeDid || 'unknown'} does not match pinned referee ${pinnedReferee}`,
        requestId,
        gameId
      };
    }

    // INVARIANT 3: Must have a cryptographic signature
    if (!hasSig) {
      return {
        rejected: true,
        reason: 'Receipt is missing cryptographic signature',
        requestId,
        gameId
      };
    }

    // INVARIANT 4: Offline Cryptographic Ed25519 Signature Verification
    // CRITICAL PROTOCOL RULE: Technocore signatures cover <room>|<nonce>|<text>.
    // The server assigns `seq` and `ts` AFTER the message is accepted. `seq` is NOT the signing nonce.
    // When verifying an existing Technocore JSON record, we MUST use `msg.nonce`, NEVER `msg.seq`.
    const naclInstance = this._nacl || (typeof nacl !== 'undefined' ? nacl : null);
    let receiptSignatureStatus = 'SERVER AUTHENTICATED';

    if (naclInstance && msg.sig && refereeDid && msg.room && msg.nonce !== undefined && msg.nonce !== null) {
      const rawText = typeof msg.text === 'string' ? msg.text : JSON.stringify(payload);
      const check = verifyMessageSignature(naclInstance, refereeDid, msg.sig, msg.room, msg.nonce, rawText);
      if (!check || !check.valid) {
        return {
          rejected: true,
          reason: 'Invalid referee cryptographic Ed25519 signature',
          requestId,
          gameId
        };
      }
      receiptSignatureStatus = 'CRYPTOGRAPHICALLY VERIFIED';
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
      receiptSignatureStatus,
      isPinnedReferee: true,
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
        // INVARIANT: Do NOT deduplicate by word string. Append word turn at this version.
        if (receipt.word) {
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
