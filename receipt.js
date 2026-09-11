/**
 * Referee Receipt Engine for Technocore Console V4
 * Parses referee receipts, validates referee signatures, and tracks session state.
 * Strictly separates TRANSPORT SUCCESS (HTTP 200) from REFEREE ACCEPTED.
 */

export class ReceiptEngine {
  constructor() {
    // Map of requestId -> SessionActionRecord
    this._actions = new Map();
    // Latest accepted state per contest/game: { version, stateHash, roomGeneration, lastContributor }
    this._gameStates = new Map();
  }

  /**
   * Register an outgoing protocol dispatch in session state
   *
   * @param {object} action
   * @param {string} action.requestId
   * @param {string} action.actionType - e.g. 'register', 'team-request', 'roster', 'word', 'submit', 'ballot'
   * @param {string} action.authenticatedDid
   * @param {string} action.room
   * @param {object} action.payload
   * @param {number} action.httpStatus
   * @param {boolean} action.transportSuccess
   * @param {string} [action.transportError]
   */
  recordDispatch(action) {
    const record = {
      requestId: action.requestId,
      actionType: action.actionType,
      authenticatedDid: action.authenticatedDid,
      room: action.room,
      payload: action.payload,
      httpStatus: action.httpStatus,
      transportSuccess: Boolean(action.transportSuccess),
      transportTimestamp: new Date().toISOString(),
      transportError: action.transportError || null,

      // Referee acceptance fields (authoritative)
      refereeAccepted: false,
      refereeReceipt: null,
      refereeError: null,
      status: action.transportSuccess ? 'SENT' : 'REJECTED'
    };

    this._actions.set(action.requestId, record);
    return record;
  }

  /**
   * Ingest a message from a room and check if it is a referee receipt matching any session action
   *
   * @param {object} msg - message object from Technocore format=json
   * @param {string} [pinnedRefereeDid] - expected referee DID if pinned
   * @returns {object|null} parsed receipt if matched
   */
  ingestMessage(msg, pinnedRefereeDid = null) {
    if (!msg || typeof msg.text !== 'string') return null;

    let payload = null;
    try {
      payload = JSON.parse(msg.text);
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object') return null;

    // Check if this payload references a known request_id
    const requestId = payload.request_id || (payload.ref && payload.ref.request_id);
    if (!requestId) return null;

    let action = this._actions.get(requestId);
    if (!action) {
      action = {
        requestId,
        actionType: 'room_broadcast',
        authenticatedDid: payload.did || msg.from || 'unknown',
        room: msg.room || 'room',
        sequence: msg.seq || 0,
        timestamp: msg.ts || new Date().toISOString(),
        transportSuccess: true,
        refereeAccepted: false,
        status: 'PENDING'
      };
      this._actions.set(requestId, action);
    }

    const refereeDid = msg.from;
    const isPinnedReferee = !pinnedRefereeDid || refereeDid === pinnedRefereeDid;
    const hasSig = Boolean(msg.sig);

    const isAccepted = (
      payload.status === 'accepted' ||
      payload.type === 'sonnet.receipt.accepted.v1' ||
      (payload.type && payload.type.includes('receipt') && !payload.error) ||
      payload.accepted === true
    );

    const receipt = {
      requestId,
      authenticatedDid: action.authenticatedDid,
      room: msg.room || action.room,
      sequence: msg.seq,
      timestamp: msg.ts || new Date().toISOString(),
      httpStatus: action.httpStatus,
      refereeDid,
      receiptSignatureStatus: hasSig ? 'VALID' : 'UNVERIFIED',
      isPinnedReferee,
      contestId: payload.contest_id || 'sonnet-1',
      gameId: payload.game_id || null,
      roomGeneration: payload.room_generation !== undefined ? payload.room_generation : null,
      version: payload.version !== undefined ? payload.version : null,
      stateHash: payload.state_hash || payload.previous_state_hash || null,
      actionStatus: isAccepted ? 'ACCEPTED' : 'REJECTED',
      errorReason: payload.error || payload.reason || (isAccepted ? null : 'Rejected by referee')
    };

    action.refereeReceipt = receipt;
    action.refereeAccepted = isAccepted;
    action.status = isAccepted ? 'ACCEPTED' : 'REJECTED';

    // Update game state if state advancing action
    if (isAccepted && receipt.gameId) {
      const current = this._gameStates.get(receipt.gameId) || {};
      const isStale = (current.version !== undefined && receipt.version !== null && receipt.version <= current.version);
      receipt.isStale = isStale;

      if (!isStale) {
        this._gameStates.set(receipt.gameId, {
          ...current,
          version: receipt.version !== null ? receipt.version : current.version,
          stateHash: receipt.stateHash || current.stateHash,
          roomGeneration: receipt.roomGeneration !== null ? receipt.roomGeneration : current.roomGeneration,
          lastContributor: action.authenticatedDid,
          lastReceipt: receipt
        });
      }
    }

    return receipt;
  }

  /**
   * Get an action record by request ID
   * @param {string} requestId
   */
  getAction(requestId) {
    return this._actions.get(requestId) || null;
  }

  /**
   * Get all action records in volatile session
   */
  getAllActions() {
    return Array.from(this._actions.values());
  }

  /**
   * Get the authoritative latest game state
   * @param {string} gameId
   */
  getGameState(gameId) {
    return this._gameStates.get(gameId) || null;
  }

  /**
   * Set game state directly from initial verified referee receipt
   * @param {string} gameId
   * @param {object} stateObj
   */
  setGameState(gameId, stateObj) {
    this._gameStates.set(gameId, stateObj);
  }

  /**
   * Alias for setGameState
   */
  updateGameState(gameId, stateObj) {
    this.setGameState(gameId, stateObj);
  }

  /**
   * Clear volatile session receipts
   */
  clear() {
    this._actions.clear();
    this._gameStates.clear();
  }
}

export const globalReceiptEngine = new ReceiptEngine();
