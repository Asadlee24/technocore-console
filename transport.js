/**
 * Transport Layer for Technocore Protocol V4
 * Implements Signed POST (preferred) with automatic Signed GET fallback,
 * universal protocol request routing via Vercel proxy or direct fetch,
 * and an incremental, rate-limit-aware RoomPoller with AbortController.
 */

import { sweepSingleLine, isValidProtocolName } from './protocol.js';
import { signMessage } from './crypto.js';
import { globalNonceManager } from './nonce.js';

export const BASE_URL = 'https://technocore.chat';

/**
 * Universal protocol request fetcher.
 * Automatically tries self-hosted /api/proxy first, then direct fetch fallback.
 *
 * @param {string} pathAndQuery
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {string|object} [options.body]
 * @param {object} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ ok: boolean, status: number, text: string, json?: any, headers: Headers }>}
 */
export async function fetchProtocol(pathAndQuery, options = {}) {
  const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery.slice(1) : pathAndQuery;
  const directUrl = `${BASE_URL}/${cleanPath}`;
  const method = (options.method || 'GET').toUpperCase();

  const reqHeaders = {
    'Accept': 'application/json, text/plain, */*',
    ...(options.headers || {})
  };

  let bodyStr = undefined;
  if (options.body !== undefined && options.body !== null) {
    bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
  }

  // Strategy 1: Serverless proxy on Vercel
  try {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(directUrl)}`;
    const proxyRes = await fetch(proxyUrl, {
      method,
      headers: reqHeaders,
      body: bodyStr,
      signal: options.signal
    });

    if (proxyRes.status !== 404 && proxyRes.status !== 502) {
      const text = await proxyRes.text();
      let json = undefined;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return {
        ok: proxyRes.ok,
        status: proxyRes.status,
        text,
        json,
        headers: proxyRes.headers
      };
    }
  } catch (proxyErr) {
    if (proxyErr.name === 'AbortError') throw proxyErr;
    // Proxy not reachable (e.g. Local static file server mode)
  }

  // Strategy 2: Direct browser fetch to technocore.chat
  try {
    const directRes = await fetch(directUrl, {
      method,
      headers: reqHeaders,
      body: bodyStr,
      signal: options.signal
    });

    const text = await directRes.text();
    let json = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }

    return {
      ok: directRes.ok,
      status: directRes.status,
      text,
      json,
      headers: directRes.headers
    };
  } catch (directErr) {
    if (directErr.name === 'AbortError') throw directErr;
    throw new Error(`Unable to connect to technocore.chat: ${directErr.message}`);
  }
}

/**
 * Dispatch a signed message to a room using Preferred Signed POST with Signed GET fallback.
 * Never sends raw private keys or seeds.
 *
 * @param {object} params
 * @param {string} params.room
 * @param {string} params.did
 * @param {string} params.sig - 86-char base64url signature
 * @param {string} params.nonce - 1-19 digit decimal string
 * @param {string} params.text - message text
 * @returns {Promise<{ ok: boolean, status: number, text: string, json?: any, lane: 'POST'|'GET' }>}
 */
export async function dispatchSignedMessage(arg1, keypair, roomName, messageText) {
  let room, did, sig, nonce, text;

  if (arg1 && typeof arg1 === 'object' && !keypair && (arg1.did || arg1.sig || arg1.nonce)) {
    ({ room, did, sig, nonce, text } = arg1);
  } else {
    // Called as: dispatchSignedMessage(naclInstance, keypair, room, text)
    const naclInstance = arg1;
    room = roomName;
    did = keypair ? keypair.did : '';
    nonce = globalNonceManager.nextNonce(did, room);
    sig = signMessage(naclInstance, keypair.secretKey, room, nonce, messageText);
    text = messageText;
  }

  const cleanRoom = (room || 'lobby').trim().toLowerCase();
  const swept = sweepSingleLine(text);
  const nonceStr = String(nonce).trim();

  // Attempt 1: Signed POST lane
  try {
    const postBody = {
      did,
      sig,
      nonce: nonceStr,
      text: swept
    };

    const res = await fetchProtocol(`r/${cleanRoom}?format=json`, {
      method: 'POST',
      body: postBody,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // If successful or rejected with semantic error (400, 403, 422, 429), return directly
    if (res.ok || (res.status !== 404 && res.status !== 405 && res.status < 500)) {
      return { ...res, lane: 'POST', transport: 'POST' };
    }
  } catch {
    // POST lane network or proxy issue, proceed to Signed GET fallback
  }

  // Attempt 2: Signed GET fallback lane
  const encodedText = encodeURIComponent(swept);
  const getPath = `r/${cleanRoom}/say-signed/${did}/${sig}/${nonceStr}/${encodedText}`;
  const res = await fetchProtocol(getPath, { method: 'GET' });
  return { ...res, lane: 'GET', transport: 'GET' };
}

/**
 * Dispatch an anonymous message to a room
 */
export async function dispatchAnonymousMessage(arg1, nickParam, textParam) {
  let room, nick, text;
  if (arg1 && typeof arg1 === 'object' && !nickParam) {
    ({ room, nick, text } = arg1);
  } else {
    room = arg1;
    nick = nickParam;
    text = textParam;
  }

  const cleanRoom = (room || 'lobby').trim().toLowerCase();
  const cleanNick = (nick || 'anon').trim().toLowerCase().slice(0, 48);
  const swept = sweepSingleLine(text);

  // Attempt POST first
  try {
    const res = await fetchProtocol(`r/${cleanRoom}?format=json`, {
      method: 'POST',
      body: { from: cleanNick, text: swept },
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok || (res.status !== 404 && res.status !== 405 && res.status < 500)) {
      return { ...res, lane: 'POST', transport: 'POST' };
    }
  } catch {
    // Fallback to GET
  }

  const encodedText = encodeURIComponent(swept);
  const getPath = `r/${cleanRoom}/say/${cleanNick}/${encodedText}`;
  const res = await fetchProtocol(getPath, { method: 'GET' });
  return { ...res, lane: 'GET', transport: 'GET' };
}

/**
 * Incremental Room Poller with AbortController, backoff, and jitter
 */
export class RoomPoller {
  constructor(room, onMessagesOrOptions, onStatus) {
    this.room = (room || 'lobby').trim().toLowerCase();
    if (typeof onMessagesOrOptions === 'function') {
      this.onMessages = onMessagesOrOptions;
      this.onStatus = typeof onStatus === 'function' ? onStatus : (() => {});
    } else if (onMessagesOrOptions && typeof onMessagesOrOptions === 'object') {
      this.onMessages = typeof onMessagesOrOptions.onMessages === 'function' ? onMessagesOrOptions.onMessages : (() => {});
      this.onStatus = typeof onMessagesOrOptions.onStatus === 'function' ? onMessagesOrOptions.onStatus : (typeof onStatus === 'function' ? onStatus : (() => {}));
    } else {
      this.onMessages = () => {};
      this.onStatus = typeof onStatus === 'function' ? onStatus : (() => {});
    }
    this.lastSeq = 0;
    this.generation = null;
    this.isRunning = false;
    this.abortController = null;
    this.backoffMs = 1000;
  }

  computeBackoff(iteration = 0) {
    const base = Math.min(1000 * Math.pow(2, iteration), 30000);
    const jitter = Math.floor(Math.random() * 500);
    return Math.min(base + jitter, 30500);
  }

  start(initialSeq = 0) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastSeq = initialSeq;
    this._pollLoop();
  }

  stop() {
    this.isRunning = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.onStatus('idle');
  }

  async _pollLoop() {
    while (this.isRunning) {
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      try {
        this.onStatus('connecting');
        const queryParams = new URLSearchParams({
          format: 'json',
          since: String(this.lastSeq),
          wait: '10'
        });

        const res = await fetchProtocol(`r/${this.room}?${queryParams.toString()}`, { signal });

        if (!this.isRunning) break;

        if (res.ok && res.json) {
          this.backoffMs = 1000; // Reset backoff
          const data = res.json;

          if (data.last_seq !== undefined && data.last_seq !== null) {
            this.lastSeq = data.last_seq;
          }

          if (data.generation !== undefined) {
            this.generation = data.generation;
          }

          if (Array.isArray(data.messages) && data.messages.length > 0) {
            this.onMessages(data.messages, {
              room: data.room,
              count: data.count,
              firstSeq: data.first_seq,
              lastSeq: data.last_seq,
              generation: this.generation
            });
          }

          this.onStatus('connected');

          // If long poll was not held by server, brief sleep before next cycle
          if (data.wait_held === false) {
            await new Promise(r => setTimeout(r, 2000));
          }
        } else if (res.status === 429) {
          // Rate limited: extract retry delay from body or header
          let delaySeconds = 5;
          const match = (res.text || '').match(/(\d+)\s*seconds/i);
          if (match && match[1]) {
            delaySeconds = Math.max(1, parseInt(match[1], 10));
          }
          this.onStatus('rate_limited', delaySeconds);
          const jitter = Math.floor(Math.random() * 500);
          await new Promise(r => setTimeout(r, delaySeconds * 1000 + jitter));
        } else if (res.status === 503 || res.status >= 500) {
          // Server error: exponential backoff with jitter
          this.onStatus('reconnecting');
          const jitter = Math.floor(Math.random() * 500);
          await new Promise(r => setTimeout(r, this.backoffMs + jitter));
          this.backoffMs = Math.min(this.backoffMs * 2, 30000);
        } else {
          // Other status (e.g. 404 if room empty)
          this.onStatus('quiet');
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (err) {
        if (!this.isRunning) break;
        if (err.name === 'AbortError') break;

        this.onStatus('offline', err.message);
        const jitter = Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, this.backoffMs + jitter));
        this.backoffMs = Math.min(this.backoffMs * 2, 30000);
      }
    }
  }
}
