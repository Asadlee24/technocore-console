/**
 * Nonce Manager for Technocore Protocol
 * Generates strictly monotonic 1-19 digit nonces per (did, room).
 * Handles high-concurrency requests, detects server nonce rejections,
 * and recovers intelligently without persisting sensitive data.
 */

export class NonceManager {
  constructor() {
    // Map of `${did}:${room}` -> BigInt (last generated nonce)
    this._roomNonces = new Map();
  }

  /**
   * Resolve DID and room regardless of argument order
   * @private
   */
  _resolveDidAndRoom(arg1, arg2) {
    let did = 'anonymous';
    let room = 'lobby';
    if (typeof arg1 === 'string' && (arg1.startsWith('did:key:') || arg1.startsWith('did:'))) {
      did = arg1.trim();
      room = (arg2 || 'lobby').trim().toLowerCase();
    } else if (typeof arg2 === 'string' && (arg2.startsWith('did:key:') || arg2.startsWith('did:'))) {
      did = arg2.trim();
      room = (arg1 || 'lobby').trim().toLowerCase();
    } else {
      did = (arg1 || 'anonymous').trim();
      room = (arg2 || 'lobby').trim().toLowerCase();
    }
    return { did, room };
  }

  /**
   * Get composite key
   * @private
   */
  _getKey(did, room) {
    const { did: cleanDid, room: cleanRoom } = this._resolveDidAndRoom(did, room);
    return `${cleanDid}:${cleanRoom}`;
  }

  /**
   * Generate the next strictly increasing nonce for this key and room.
   * Format: 1-19 digits decimal string (safe for BigInt and JSON serialization).
   *
   * @param {string} arg1 - DID or room
   * @param {string} arg2 - room or DID
   * @returns {string} Decimal string of 1-19 digits
   */
  nextNonce(arg1, arg2) {
    const { did, room } = this._resolveDidAndRoom(arg1, arg2);
    const key = `${did}:${room}`;
    const nowMs = BigInt(Date.now());
    const last = this._roomNonces.get(key) || 0n;

    // Must be strictly greater than last and at least nowMs
    let next = nowMs > last ? nowMs : last + 1n;

    this._roomNonces.set(key, next);
    return next.toString();
  }

  /**
   * Alias for nextNonce
   */
  getNextNonce(arg1, arg2) {
    return this.nextNonce(arg1, arg2);
  }

  /**
   * Record that a nonce was accepted by the server
   *
   * @param {string} did
   * @param {string} room
   * @param {string|number|bigint} nonce
   */
  recordAccepted(did, room, nonce) {
    const key = this._getKey(did, room);
    const parsed = BigInt(nonce);
    const current = this._roomNonces.get(key) || 0n;
    if (parsed > current) {
      this._roomNonces.set(key, parsed);
    }
  }

  /**
   * Recover from a server nonce rejection.
   * If server returned 400 error mentioning nonce or previous sequence,
   * inspect error message or advance nonce past the rejected value.
   *
   * @param {string} did
   * @param {string} room
   * @param {string|number|bigint} rejectedNonce
   * @param {string} [errorMessage]
   * @returns {string} Next recovered nonce to retry
   */
  recoverFromRejection(did, room, rejectedNonce, errorMessage = '') {
    const key = this._getKey(did, room);
    let floor = BigInt(rejectedNonce);

    // If error message specifies a required minimum nonce or server's current nonce, parse it
    // e.g. "nonce must be greater than 1725000000000"
    const match = errorMessage.match(/greater than (\d+)/i) || errorMessage.match(/nonce[:\s]+(\d+)/i);
    if (match && match[1]) {
      try {
        const serverMin = BigInt(match[1]);
        if (serverMin > floor) floor = serverMin;
      } catch {
        // Fallback to floor
      }
    }

    const current = this._roomNonces.get(key) || 0n;
    const higher = current > floor ? current : floor;
    const recovered = higher + 1000n; // Advance past the collision
    this._roomNonces.set(key, recovered);
    return recovered.toString();
  }

  /**
   * Check if an HTTP error response indicates a nonce failure
   * @param {number} status
   * @param {string} body
   * @returns {boolean}
   */
  static isNonceError(status, body) {
    if (status === 400) {
      const lower = (body || '').toLowerCase();
      return lower.includes('nonce') || lower.includes('replay');
    }
    return false;
  }

  /**
   * Clear volatile memory
   */
  clear() {
    this._roomNonces.clear();
  }
}

// Global default singleton instance
export const globalNonceManager = new NonceManager();
export const nonceManager = globalNonceManager;

