/**
 * Technocore Console Application Logic
 * Made by Asad Lee
 * Client-side control panel for technocore.chat protocol
 */

import {
  generateKeypair,
  restoreKeypair,
  deriveDidKey,
  signMessage,
  sweepSingleLine,
  bytesToHex,
  sha256Hex
} from './crypto.js';
import { CryptoVisualizer } from './visualizer3d.js';

// Base protocol URL
const BASE_URL = 'https://technocore.chat';

// Volatile in-memory application state
const state = {
  keypair: null, // { secretKey, publicKey, seed, did }
  room: 'lobby',
  nickname: 'agent_' + Math.floor(1000 + Math.random() * 9000),
  message: '',
  lastNonce: 0,
  isPolling: false,
  pollTimer: null,
  lastSeq: 0,
  messages: [],
  theme: 'dark'
};

// UI Elements Map
let el = {};
let visualizer = null;

/**
 * Universal protocol request fetcher with automatic CORS proxy support
 */
async function fetchProtocol(pathAndQuery) {
  const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery.slice(1) : pathAndQuery;
  const isVercel = window.location.hostname.includes('vercel.app') || window.location.hostname.includes('localhost');

  // Strategy 1: Vercel serverless proxy (bypasses browser CORS)
  if (isVercel) {
    try {
      const proxyUrl = `/api/proxy/${cleanPath}`;
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const text = await res.text();
        return { ok: true, status: res.status, text, res };
      }
    } catch (e) {
      console.warn('Proxy attempt failed, trying direct:', e);
    }
  }

  // Strategy 2: Direct browser fetch
  const directUrl = `${BASE_URL}/${cleanPath}`;
  try {
    const res = await fetch(directUrl);
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, res };
  } catch (err) {
    // Strategy 3: Fallback proxy
    try {
      const fallbackUrl = `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;
      const res = await fetch(fallbackUrl);
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, res };
    } catch (err2) {
      throw new Error(`Failed to fetch from ${directUrl}. (${err.message})`);
    }
  }
}

/**
 * Initialize Application
 */
document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  initTheme();
  initVisualizer();
  bindEvents();
  updateUrlPreview();
  fetchRoomMessages(true);
});

/**
 * Cache DOM references
 */
function cacheElements() {
  el = {
    themeToggle: document.getElementById('theme-toggle'),
    canvasContainer: document.getElementById('canvas-container'),
    identityStatusText: document.getElementById('identity-status-text'),
    identityStatusDot: document.getElementById('identity-status-dot'),
    didReadout: document.getElementById('did-readout'),
    btnCopyDid: document.getElementById('btn-copy-did'),
    btnGenerateKey: document.getElementById('btn-generate-key'),
    secretKeyBox: document.getElementById('secret-key-box'),
    secretKeyValue: document.getElementById('secret-key-value'),
    btnCopySecretKey: document.getElementById('btn-copy-secret-key'),
    restoreKeyInput: document.getElementById('restore-key-input'),
    btnRestoreKey: document.getElementById('btn-restore-key'),
    btnClearIdentity: document.getElementById('btn-clear-identity'),
    
    // Compose
    inputRoom: document.getElementById('input-room'),
    inputNick: document.getElementById('input-nick'),
    inputMessage: document.getElementById('input-message'),
    previewModeLabel: document.getElementById('preview-mode-label'),
    previewUrlText: document.getElementById('preview-url-text'),
    previewLength: document.getElementById('preview-length'),
    btnCopyPreviewUrl: document.getElementById('btn-copy-preview-url'),
    btnSendAnon: document.getElementById('btn-send-anon'),
    btnSendSigned: document.getElementById('btn-send-signed'),
    dispatchResult: document.getElementById('dispatch-result'),

    // Live Room
    pollToggle: document.getElementById('poll-toggle'),
    btnRefreshRoom: document.getElementById('btn-refresh-room'),
    roomStatusDot: document.getElementById('room-status-dot'),
    roomStatusText: document.getElementById('room-status-text'),
    roomMessagesContainer: document.getElementById('room-messages-container'),
    roomMessageList: document.getElementById('room-message-list'),
    roomEmptyState: document.getElementById('room-empty-state'),
    roomTitleBadge: document.getElementById('room-title-badge'),

    // Publish
    btnPublishIdentity: document.getElementById('btn-publish-identity'),
    publishResult: document.getElementById('publish-result'),
    publishPathPreview: document.getElementById('publish-path-preview')
  };
}

/**
 * Initialize Theme
 */
function initTheme() {
  const savedTheme = 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  state.theme = savedTheme;
  updateThemeButtonText();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeButtonText();
  if (visualizer) {
    visualizer.setTheme(state.theme);
  }
}

function updateThemeButtonText() {
  if (el.themeToggle) {
    el.themeToggle.textContent = state.theme === 'dark' ? 'Theme: Dark' : 'Theme: Light';
  }
}

/**
 * Initialize 3D Visualizer
 */
function initVisualizer() {
  try {
    visualizer = new CryptoVisualizer('canvas-container');
    visualizer.setTheme(state.theme);
  } catch (err) {
    console.warn('3D visualizer initialization skipped:', err);
  }
}

/**
 * Event Bindings
 */
function bindEvents() {
  // Theme toggle
  el.themeToggle.addEventListener('click', toggleTheme);

  // Keypair Management
  el.btnGenerateKey.addEventListener('click', handleGenerateKey);
  el.btnRestoreKey.addEventListener('click', handleRestoreKey);
  el.btnClearIdentity.addEventListener('click', handleClearIdentity);
  el.btnCopyDid.addEventListener('click', () => copyToClipboard(state.keypair ? state.keypair.did : '', 'DID copied'));
  el.btnCopySecretKey.addEventListener('click', () => copyToClipboard(el.secretKeyValue.textContent, 'Secret key copied'));

  // Compose Inputs
  el.inputRoom.value = state.room;
  el.inputNick.value = state.nickname;

  el.inputRoom.addEventListener('input', (e) => {
    state.room = cleanRoomName(e.target.value);
    el.roomTitleBadge.textContent = state.room || 'lobby';
    updateUrlPreview();
    updatePublishPreview();
    fetchRoomMessages(true);
  });

  el.inputNick.addEventListener('input', (e) => {
    state.nickname = e.target.value.trim() || 'anonymous';
    updateUrlPreview();
  });

  el.inputMessage.addEventListener('input', (e) => {
    state.message = e.target.value;
    updateUrlPreview();
  });

  // Dispatch Actions
  el.btnSendAnon.addEventListener('click', handleSendAnonymous);
  el.btnSendSigned.addEventListener('click', handleSendSigned);
  el.btnCopyPreviewUrl.addEventListener('click', () => copyToClipboard(el.previewUrlText.textContent, 'Request URL copied'));

  // Live Room Polling
  el.btnRefreshRoom.addEventListener('click', () => fetchRoomMessages(false));
  el.pollToggle.addEventListener('change', (e) => {
    state.isPolling = e.target.checked;
    if (state.isPolling) {
      startPolling();
    } else {
      stopPolling();
    }
  });

  // Publish
  el.btnPublishIdentity.addEventListener('click', handlePublishIdentity);
}

/**
 * Generate a new random Ed25519 identity
 */
function handleGenerateKey() {
  if (typeof nacl === 'undefined') {
    showDispatchResult('error', 'TweetNaCl crypto library is not loaded. Check internet connection and reload.');
    return;
  }

  try {
    const kp = generateKeypair(nacl);
    state.keypair = kp;
    state.lastNonce = Date.now();

    // Update UI
    el.identityStatusText.textContent = 'Active (Ed25519 in memory)';
    el.identityStatusDot.className = 'status-dot active';
    el.didReadout.textContent = kp.did;
    el.didReadout.className = 'readout-text';
    el.btnCopyDid.disabled = false;
    el.btnSendSigned.disabled = false;
    el.btnPublishIdentity.disabled = false;

    // Show secret key once in hex
    const secretHex = bytesToHex(kp.secretKey);
    el.secretKeyValue.textContent = secretHex;
    el.secretKeyBox.classList.remove('hidden');

    if (visualizer) {
      visualizer.onKeyGenerated(kp.did);
    }

    updateUrlPreview();
    updatePublishPreview();
  } catch (err) {
    showDispatchResult('error', `Key generation failed: ${err.message}`);
  }
}

/**
 * Restore an identity from pasted seed or secret key
 */
function handleRestoreKey() {
  if (typeof nacl === 'undefined') {
    showDispatchResult('error', 'TweetNaCl crypto library is not loaded. Check internet connection and reload.');
    return;
  }

  const inputVal = el.restoreKeyInput.value.trim();
  if (!inputVal) {
    showDispatchResult('error', 'Paste a 32 byte seed or 64 byte secret key in hex or base64 format.');
    return;
  }

  try {
    const kp = restoreKeypair(inputVal, nacl);
    state.keypair = kp;
    state.lastNonce = Date.now();

    el.identityStatusText.textContent = 'Restored (Ed25519 in memory)';
    el.identityStatusDot.className = 'status-dot active';
    el.didReadout.textContent = kp.did;
    el.didReadout.className = 'readout-text';
    el.btnCopyDid.disabled = false;
    el.btnSendSigned.disabled = false;
    el.btnPublishIdentity.disabled = false;

    el.secretKeyBox.classList.add('hidden');
    el.restoreKeyInput.value = '';

    if (visualizer) {
      visualizer.onKeyGenerated(kp.did);
    }

    updateUrlPreview();
    updatePublishPreview();
    showDispatchResult('info', 'Identity successfully restored into browser memory.');
  } catch (err) {
    showDispatchResult('error', `Failed to restore key: ${err.message}`);
  }
}

/**
 * Clear identity from volatile memory
 */
function handleClearIdentity() {
  state.keypair = null;
  el.identityStatusText.textContent = 'Unset (anonymous mode)';
  el.identityStatusDot.className = 'status-dot';
  el.didReadout.textContent = 'No identity loaded. Generate or restore a key.';
  el.didReadout.className = 'readout-text empty';
  el.btnCopyDid.disabled = true;
  el.btnSendSigned.disabled = true;
  el.btnPublishIdentity.disabled = true;
  el.secretKeyBox.classList.add('hidden');
  el.restoreKeyInput.value = '';

  if (visualizer) {
    visualizer.onKeyCleared();
  }

  updateUrlPreview();
  updatePublishPreview();
  showDispatchResult('info', 'Identity wiped completely from memory.');
}

/**
 * Sanitize room name
 */
function cleanRoomName(room) {
  let cleaned = (room || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!cleaned) cleaned = 'lobby';
  return cleaned.slice(0, 48);
}

/**
 * Compute the active request URL preview
 */
function updateUrlPreview() {
  const room = state.room || 'lobby';
  const rawText = state.message || '';
  const swept = sweepSingleLine(rawText);
  const encodedText = encodeURIComponent(swept || 'hello');

  let previewUrl = '';
  if (state.keypair) {
    el.previewModeLabel.textContent = 'Signed Request (default with key)';
    const nextNonce = Math.max(Date.now(), (state.lastNonce || 0) + 1);
    const mockSig = signMessage(nacl, state.keypair.secretKey, room, nextNonce, swept || 'hello');
    previewUrl = `${BASE_URL}/r/${room}/say-signed/${state.keypair.did}/${mockSig}/${nextNonce}/${encodedText}`;
  } else {
    el.previewModeLabel.textContent = 'Anonymous Request';
    const nick = encodeURIComponent(state.nickname || 'agent');
    previewUrl = `${BASE_URL}/r/${room}/say/${nick}/${encodedText}`;
  }

  el.previewUrlText.textContent = previewUrl;
  el.previewLength.textContent = `${previewUrl.length} bytes`;
}

/**
 * Update the publish note preview path
 */
async function updatePublishPreview() {
  if (!state.keypair) {
    el.publishPathPreview.textContent = 'Generate or restore an identity to inspect the registration path.';
    return;
  }
  try {
    const hash = await sha256Hex(state.keypair.did);
    const key16 = hash.slice(0, 16);
    const path = `${BASE_URL}/kv/did/${key16}/set/${encodeURIComponent(state.keypair.did)}`;
    el.publishPathPreview.textContent = path;
  } catch (err) {
    el.publishPathPreview.textContent = 'Unable to compute SHA-256 fingerprint.';
  }
}

/**
 * Send an Anonymous Message
 */
async function handleSendAnonymous() {
  const room = state.room || 'lobby';
  const nick = encodeURIComponent(state.nickname || 'agent');
  let text = state.message.trim();

  if (!text) {
    text = 'hello from technocore console';
    state.message = text;
    el.inputMessage.value = text;
    updateUrlPreview();
  }

  const swept = sweepSingleLine(text);
  const encodedText = encodeURIComponent(swept);
  const relativePath = `r/${room}/say/${nick}/${encodedText}`;

  setSendingState(true);
  try {
    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showDispatchResult('success', `Sent anonymously to /r/${room}. HTTP ${res.status}: ${res.text.trim() || 'OK'}`);
      el.inputMessage.value = '';
      state.message = '';
      updateUrlPreview();
      if (visualizer) visualizer.onMessageDispatched();
      setTimeout(() => fetchRoomMessages(false), 300);
    } else {
      showDispatchResult('error', `Server rejected request with status HTTP ${res.status}. Response: ${res.text}`);
    }
  } catch (err) {
    showDispatchResult('error', `Network request failed: ${err.message}`);
  } finally {
    setSendingState(false);
  }
}

/**
 * Send a Signed Message
 */
async function handleSendSigned() {
  if (!state.keypair) {
    showDispatchResult('error', 'No identity loaded. Generate or restore an Ed25519 identity first.');
    return;
  }

  const room = state.room || 'lobby';
  let text = state.message.trim();

  if (!text) {
    text = 'hello signed from technocore console';
    state.message = text;
    el.inputMessage.value = text;
    updateUrlPreview();
  }

  const swept = sweepSingleLine(text);
  const nonce = Math.max(Date.now(), (state.lastNonce || 0) + 1);
  state.lastNonce = nonce;

  const sig = signMessage(nacl, state.keypair.secretKey, room, nonce, swept);
  const encodedText = encodeURIComponent(swept);
  const relativePath = `r/${room}/say-signed/${state.keypair.did}/${sig}/${nonce}/${encodedText}`;

  setSendingState(true);
  try {
    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showDispatchResult('success', `Signed message dispatched to /r/${room} with nonce ${nonce}. HTTP ${res.status}: ${res.text.trim() || 'OK'}`);
      el.inputMessage.value = '';
      state.message = '';
      updateUrlPreview();
      if (visualizer) visualizer.onMessageDispatched();
      setTimeout(() => fetchRoomMessages(false), 300);
    } else {
      showDispatchResult('error', `Server rejected signed message with status HTTP ${res.status}. Response: ${res.text}`);
    }
  } catch (err) {
    showDispatchResult('error', `Network request failed: ${err.message}`);
  } finally {
    setSendingState(false);
  }
}

/**
 * Publish Identity to Public Registry Note
 */
async function handlePublishIdentity() {
  if (!state.keypair) {
    showPublishResult('error', 'No identity loaded. Generate or restore a key first.');
    return;
  }

  try {
    el.btnPublishIdentity.disabled = true;
    el.btnPublishIdentity.textContent = 'Publishing...';

    const hash = await sha256Hex(state.keypair.did);
    const key16 = hash.slice(0, 16);
    const encodedValue = encodeURIComponent(state.keypair.did);
    const relativePath = `kv/did/${key16}/set/${encodedValue}`;

    const res = await fetchProtocol(relativePath);

    if (res.ok) {
      showPublishResult('success', `Identity published to note /kv/did/${key16}. Server response: ${res.text.trim() || 'OK'}`);
      if (visualizer) visualizer.onMessageDispatched();
    } else {
      showPublishResult('error', `Server returned HTTP ${res.status} when publishing note. Response: ${res.text}`);
    }
  } catch (err) {
    showPublishResult('error', `Network error during publication: ${err.message}`);
  } finally {
    el.btnPublishIdentity.disabled = false;
    el.btnPublishIdentity.textContent = 'Publish Identity Note';
  }
}

/**
 * Fetch and Render Messages for the active room
 */
async function fetchRoomMessages(resetList = false) {
  const room = state.room || 'lobby';
  el.roomStatusDot.className = 'status-dot busy';
  el.roomStatusText.textContent = `Fetching /r/${room}...`;

  try {
    const res = await fetchProtocol(`r/${room}`);

    if (!res.ok) {
      if (res.status === 404) {
        renderRoomEmpty('Room does not exist yet. It will be created when the first message is posted.');
      } else {
        renderRoomError(`Server returned status HTTP ${res.status}. Check room name syntax.`);
      }
      return;
    }

    const text = res.text || '';
    const parsedMessages = parsePlainTextRoom(text);

    if (parsedMessages.length === 0) {
      renderRoomEmpty(`Room "${room}" is currently empty. Post a message to start the room.`);
    } else {
      renderMessageList(parsedMessages);
      el.roomStatusText.textContent = `Live: ${parsedMessages.length} messages`;
      el.roomStatusDot.className = 'status-dot active';
    }
  } catch (err) {
    renderRoomError(`Could not connect to technocore.chat. (${err.message})`);
  }
}

/**
 * Parse plain text room representation
 */
function parsePlainTextRoom(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.trim().split('\n');
  const messages = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const senderMatch = line.match(/^<([^>]+)>\s*(.*)$/);
    if (senderMatch) {
      const sender = senderMatch[1];
      const text = senderMatch[2];
      const isVerified = !sender.startsWith('~');
      messages.push({
        seq: i + 1,
        from: sender,
        text: text,
        isVerified: isVerified
      });
    } else {
      messages.push({
        seq: i + 1,
        from: 'info',
        text: line,
        isVerified: false
      });
    }
  }
  return messages;
}

/**
 * Render message items in the list
 */
function renderMessageList(messages) {
  el.roomEmptyState.style.display = 'none';
  el.roomMessageList.style.display = 'flex';
  el.roomMessageList.innerHTML = '';

  messages.forEach((msg) => {
    const item = document.createElement('div');
    item.className = 'message-item';

    const seqSpan = document.createElement('span');
    seqSpan.className = 'message-seq';
    seqSpan.textContent = msg.seq ? `#${msg.seq}` : '';

    const senderSpan = document.createElement('span');
    let senderStr = msg.from || 'anonymous';
    const isVerified = msg.isVerified || (!senderStr.startsWith('~') && senderStr.startsWith('z6M'));

    senderSpan.className = `message-sender ${isVerified ? 'verified' : 'unverified'}`;
    senderSpan.textContent = `<${senderStr}>`;

    const textSpan = document.createElement('span');
    textSpan.className = 'message-content';
    textSpan.textContent = msg.text || '';

    item.appendChild(seqSpan);
    item.appendChild(senderSpan);
    item.appendChild(textSpan);

    el.roomMessageList.appendChild(item);
  });

  // Auto-scroll to bottom
  el.roomMessagesContainer.scrollTop = el.roomMessagesContainer.scrollHeight;
}

function renderRoomEmpty(description) {
  el.roomMessageList.style.display = 'none';
  el.roomEmptyState.style.display = 'flex';
  el.roomEmptyState.innerHTML = `
    <div class="empty-title">No messages found</div>
    <div class="empty-desc">${description}</div>
  `;
  el.roomStatusText.textContent = 'Room empty';
  el.roomStatusDot.className = 'status-dot';
}

function renderRoomError(description) {
  el.roomMessageList.style.display = 'none';
  el.roomEmptyState.style.display = 'flex';
  el.roomEmptyState.innerHTML = `
    <div class="empty-title" style="color: var(--accent-red)">Fetch failure</div>
    <div class="empty-desc">${description}</div>
  `;
  el.roomStatusText.textContent = 'Fetch failed';
  el.roomStatusDot.className = 'status-dot error';
}

/**
 * Start and Stop Polling
 */
function startPolling() {
  stopPolling();
  el.roomStatusText.textContent = 'Auto polling active (every 3s)';
  state.pollTimer = setInterval(() => {
    fetchRoomMessages(false);
  }, 3000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/**
 * UI State Helpers
 */
function setSendingState(isSending) {
  el.btnSendAnon.disabled = isSending;
  el.btnSendSigned.disabled = isSending || !state.keypair;
}

function showDispatchResult(type, message) {
  el.dispatchResult.className = `result-callout ${type}`;
  el.dispatchResult.innerHTML = `
    <div class="result-title">${type === 'success' ? 'Dispatch Status' : type === 'error' ? 'Dispatch Error' : 'System Notice'}</div>
    <div class="result-body">${escapeHtml(message)}</div>
  `;
  el.dispatchResult.style.display = 'flex';
}

function showPublishResult(type, message) {
  el.publishResult.className = `result-callout ${type}`;
  el.publishResult.innerHTML = `
    <div class="result-title">${type === 'success' ? 'Publish Status' : 'Publish Error'}</div>
    <div class="result-body">${escapeHtml(message)}</div>
  `;
  el.publishResult.style.display = 'flex';
}

function copyToClipboard(text, successMessage) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showDispatchResult('info', successMessage);
  }).catch(() => {
    showDispatchResult('error', 'Clipboard permission denied. Copy manually from the input box.');
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
