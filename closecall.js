/**
 * Close Call Challenge (close-1) Trading Desk Subsystem
 * Official Specification: technocore-close-call (FLOP Labs)
 * Reference: https://github.com/flop-labs/technocore-close-call-challenge
 *
 * One NVDA future, 1 POLF per USD.
 * Trades settled every 5 minutes by referee within 5% of Hyperliquid's last trade.
 * Top 3 profitable accounts win 1,000,000 FLOP after Oct 4, 2026.
 */

import { encodeBase64Url, sweepSingleLine } from './crypto.js';
import { dispatchSignedMessage, fetchProtocol } from './transport.js';

export const CLOSE_CALL_CONFIG = {
  season: 'close-1',
  roomTrade: 'close1',
  roomPrice: 'd-close1-price',
  roomFlow: 'd-close1-flow',
  roomPositions: 'd-close1-positions',
  roomPnl: 'd-close1-pnl',
  roomState: 'd-close1-state',
  minQty: 0.1,
  limitWindow: 0.05,
  startingMint: 10000
};

export const closeCallState = {
  isPolling: false,
  pollTimer: null,
  currentSweep: 0,
  referencePrice: null,
  priceTime: null,
  limits: null, // [minPx, maxPx]
  sweepCountdown: 300,
  lastSweepTimestamp: Date.now(),
  openOffers: [],
  settledTrades: [],
  topPnl: [],
  userBalance: 10000,
  userPosition: 0,
  isOwnerRegistered: false,
  selectedSide: 'buy'
};

/**
 * Serializes trade terms with strictly sorted keys and no whitespace.
 * Keys: id, maker, px, qty, side, taker, until
 */
export function buildCanonicalTerms(terms) {
  const sortedObj = {
    id: String(terms.id).trim(),
    maker: String(terms.maker).trim(),
    px: Number(terms.px).toFixed(2),
    qty: Number(terms.qty).toFixed(2),
    side: terms.side === 'sell' ? 'sell' : 'buy',
    taker: String(terms.taker || 'any').trim(),
    until: parseInt(terms.until, 10)
  };

  // Re-encode ensuring exact JSON with sorted keys
  return JSON.stringify({
    id: sortedObj.id,
    maker: sortedObj.maker,
    px: sortedObj.px,
    qty: sortedObj.qty,
    side: sortedObj.side,
    taker: sortedObj.taker,
    until: sortedObj.until
  });
}

/**
 * Maker signature: signs `close-1|terms|<canonical_terms>`
 */
export function signMakerTerms(naclInstance, secretKey, canonicalTerms) {
  const payload = `close-1|terms|${canonicalTerms}`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(payload);
  const sigBytes = naclInstance.sign.detached(bytes, secretKey);
  return encodeBase64Url(sigBytes);
}

/**
 * Taker signature: signs `close-1|accept|<canonical_terms>|<taker_did>`
 */
export function signTakerAccept(naclInstance, secretKey, canonicalTerms, takerDid) {
  const payload = `close-1|accept|${canonicalTerms}|${takerDid}`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(payload);
  const sigBytes = naclInstance.sign.detached(bytes, secretKey);
  return encodeBase64Url(sigBytes);
}

/**
 * Fetch referee price, limits, and current sweep from `d-close1-price`
 */
export async function fetchCloseCallPrice() {
  try {
    const res = await fetchProtocol(`r/${CLOSE_CALL_CONFIG.roomPrice}?limit=5`);
    if (!res.ok) return null;
    const lines = res.text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('next:')) continue;
      
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0]);
          if (data.t === 'price' || data.t === 'seed') {
            closeCallState.currentSweep = data.n || data.for || closeCallState.currentSweep;
            if (data.ref && data.ref.px) {
              closeCallState.referencePrice = parseFloat(data.ref.px);
              closeCallState.priceTime = data.ref.time;
            } else if (data.price) {
              closeCallState.referencePrice = parseFloat(data.price);
            }
            if (data.limits && Array.isArray(data.limits) && data.limits.length === 2) {
              closeCallState.limits = [parseFloat(data.limits[0]), parseFloat(data.limits[1])];
            } else if (closeCallState.referencePrice) {
              closeCallState.limits = [
                Math.round(closeCallState.referencePrice * 0.95 * 100) / 100,
                Math.round(closeCallState.referencePrice * 1.05 * 100) / 100
              ];
            }
            return data;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Failed to fetch close call price:', err);
  }
  return null;
}

/**
 * Fetch leaderboard PnL from `d-close1-pnl`
 */
export async function fetchCloseCallPnl() {
  try {
    const res = await fetchProtocol(`r/${CLOSE_CALL_CONFIG.roomPnl}?limit=5`);
    if (!res.ok) return [];
    const lines = res.text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0]);
          if (data.t === 'pnl' && Array.isArray(data.top)) {
            closeCallState.topPnl = data.top;
            return data.top;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Failed to fetch close call PnL:', err);
  }
  return [];
}

/**
 * Fetch recent trade flow and mints from `d-close1-flow`
 */
export async function fetchCloseCallFlow() {
  try {
    const res = await fetchProtocol(`r/${CLOSE_CALL_CONFIG.roomFlow}?limit=10`);
    if (!res.ok) return [];
    const lines = res.text.split('\n');
    const flows = [];
    for (const line of lines) {
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0]);
          if (data.t === 'flow') {
            flows.push(data);
          }
        } catch {}
      }
    }
    closeCallState.settledTrades = flows.slice(-5);
    return flows;
  } catch (err) {
    console.warn('Failed to fetch close call flow:', err);
  }
  return [];
}

/**
 * Fetch open offers and executed trades from `close1`
 */
export async function fetchCloseCallOrders(currentDid) {
  try {
    const res = await fetchProtocol(`r/${CLOSE_CALL_CONFIG.roomTrade}?limit=50`);
    if (!res.ok) return [];
    const lines = res.text.split('\n');
    const offers = [];

    for (const line of lines) {
      const jsonMatch = line.match(/\{.*\}/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0]);
          // Check if it's an open trade offer or a countersignable trade
          if (data.t === 'trade' && data.terms) {
            // Already matched trade
          } else if ((data.t === 'offer' && data.terms) || (data.terms && data.maker_sig && !data.taker_sig)) {
            const t = data.terms;
            // Check expiry
            if (!t.until || t.until >= closeCallState.currentSweep) {
              offers.push({
                raw: data,
                terms: t,
                makerSig: data.maker_sig || data.sig,
                isOwn: currentDid && t.maker.toLowerCase() === currentDid.toLowerCase()
              });
            }
          }
        } catch {}
      }
    }
    closeCallState.openOffers = offers;
    return offers;
  } catch (err) {
    console.warn('Failed to fetch close call orders:', err);
  }
  return [];
}

/**
 * 1-Click Register Owner (Claim 10,000 POLF)
 */
export async function claimCloseCallPolf(naclInstance, keypair) {
  if (!keypair || !keypair.did) {
    throw new Error('Generate or load an identity first.');
  }

  const payload = JSON.stringify({
    t: 'owner',
    season: CLOSE_CALL_CONFIG.season,
    key: keypair.did
  });

  const res = await dispatchSignedMessage(naclInstance, keypair, CLOSE_CALL_CONFIG.roomTrade, payload);
  if (!res.ok) {
    throw new Error(`Broadcast failed with HTTP ${res.status}: ${res.text}`);
  }
  closeCallState.isOwnerRegistered = true;
  return res;
}

/**
 * 1-Click Create & Broadcast Trade Offer (Maker)
 */
export async function createAndBroadcastOffer(naclInstance, keypair, { side, px, qty, taker = 'any', untilSweeps = 24 }) {
  if (!keypair || !keypair.did) {
    throw new Error('Generate or load an identity first.');
  }

  const priceNum = parseFloat(px);
  const qtyNum = parseFloat(qty);

  if (isNaN(priceNum) || priceNum <= 0) {
    throw new Error('Enter a valid price greater than 0.');
  }
  if (isNaN(qtyNum) || qtyNum < CLOSE_CALL_CONFIG.minQty) {
    throw new Error(`Minimum contract quantity is ${CLOSE_CALL_CONFIG.minQty}.`);
  }

  // Validate within limits if available
  if (closeCallState.limits) {
    const [minPx, maxPx] = closeCallState.limits;
    if (priceNum < minPx || priceNum > maxPx) {
      throw new Error(`Price $${priceNum.toFixed(2)} is outside allowed 5% sweep limits ($${minPx.toFixed(2)} - $${maxPx.toFixed(2)}).`);
    }
  }

  const currentN = closeCallState.currentSweep || 1;
  const untilSweep = currentN + parseInt(untilSweeps, 10);
  const tradeId = 't_' + Math.random().toString(36).substring(2, 10);

  const termsObj = {
    id: tradeId,
    maker: keypair.did,
    px: priceNum.toFixed(2),
    qty: qtyNum.toFixed(2),
    side: side === 'sell' ? 'sell' : 'buy',
    taker: taker.trim() || 'any',
    until: untilSweep
  };

  const canonicalTerms = buildCanonicalTerms(termsObj);
  const makerSig = signMakerTerms(naclInstance, keypair.secretKey, canonicalTerms);

  const offerMessage = JSON.stringify({
    t: 'offer',
    season: CLOSE_CALL_CONFIG.season,
    terms: JSON.parse(canonicalTerms),
    maker_sig: makerSig
  });

  const res = await dispatchSignedMessage(naclInstance, keypair, CLOSE_CALL_CONFIG.roomTrade, offerMessage);
  if (!res.ok) {
    throw new Error(`Failed to post offer to /r/${CLOSE_CALL_CONFIG.roomTrade}: HTTP ${res.status}`);
  }

  return {
    terms: termsObj,
    makerSig,
    res
  };
}

/**
 * 1-Click Accept Open Offer & Execute Trade (Taker)
 */
export async function acceptAndExecuteOffer(naclInstance, keypair, offer) {
  if (!keypair || !keypair.did) {
    throw new Error('Generate or load an identity first.');
  }

  const terms = offer.terms;
  if (terms.maker.toLowerCase() === keypair.did.toLowerCase()) {
    throw new Error('You cannot trade with your own offer (self-trading disallowed).');
  }

  const canonicalTerms = buildCanonicalTerms(terms);
  const takerSig = signTakerAccept(naclInstance, keypair.secretKey, canonicalTerms, keypair.did);

  const tradeMessage = JSON.stringify({
    t: 'trade',
    season: CLOSE_CALL_CONFIG.season,
    terms: JSON.parse(canonicalTerms),
    taker: keypair.did,
    maker_sig: offer.makerSig,
    taker_sig: takerSig
  });

  const res = await dispatchSignedMessage(naclInstance, keypair, CLOSE_CALL_CONFIG.roomTrade, tradeMessage);
  if (!res.ok) {
    throw new Error(`Failed to broadcast trade execution: HTTP ${res.status}`);
  }

  return {
    trade: tradeMessage,
    res
  };
}

// Internal UI references and callbacks
let _dom = {};
let _state = null;
let _nacl = null;
let _toast = null;
let _countdownTimer = null;
let _dataTimer = null;

/**
 * Initialize Close Call Trading Desk UI Controller
 */
export function initCloseCallUI(domElements, appState, naclInstance, toastFunction) {
  _dom = domElements;
  _state = appState;
  _nacl = naclInstance;
  _toast = toastFunction || ((msg) => console.log(msg));

  // Bind side toggle buttons
  const btnBuy = document.getElementById('btn-side-buy');
  const btnSell = document.getElementById('btn-side-sell');
  if (btnBuy && btnSell) {
    btnBuy.addEventListener('click', () => {
      closeCallState.selectedSide = 'buy';
      btnBuy.classList.add('active');
      btnSell.classList.remove('active');
      recalculateOrderSummary();
    });
    btnSell.addEventListener('click', () => {
      closeCallState.selectedSide = 'sell';
      btnSell.classList.add('active');
      btnBuy.classList.remove('active');
      recalculateOrderSummary();
    });
  }

  // Bind calculation listeners
  const inputPx = document.getElementById('closecall-input-px');
  const inputQty = document.getElementById('closecall-input-qty');
  if (inputPx) inputPx.addEventListener('input', recalculateOrderSummary);
  if (inputQty) inputQty.addEventListener('input', recalculateOrderSummary);

  // Bind Mint / Claim 10,000 POLF
  const btnMint = document.getElementById('btn-closecall-claim-mint');
  if (btnMint) {
    btnMint.addEventListener('click', async () => {
      if (!_state.keypair || !_state.keypair.did) {
        _toast('Please generate or restore an identity in Step 1 first.', 'error');
        return;
      }
      btnMint.disabled = true;
      btnMint.textContent = 'Broadcasting owner claim...';
      try {
        await claimCloseCallPolf(_nacl || window.nacl, _state.keypair);
        _toast('Success! 10,000 POLF starting bankroll claimed in /r/close1.', 'success');
        const badge = document.getElementById('closecall-reg-badge');
        if (badge) {
          badge.className = 'step-status-pill complete';
          badge.textContent = 'Registered (10,000 POLF)';
        }
      } catch (err) {
        _toast(`Registration failed: ${err.message}`, 'error');
      } finally {
        btnMint.disabled = false;
        btnMint.textContent = '⚡ Mint / Claim 10,000 POLF in /r/close1';
      }
    });
  }

  // Bind Submit Offer Button
  const btnSubmit = document.getElementById('btn-closecall-submit-offer');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      if (!_state.keypair || !_state.keypair.did) {
        _toast('Please load an identity before placing orders.', 'error');
        return;
      }

      const pxVal = inputPx ? inputPx.value.trim() : '';
      const qtyVal = inputQty ? inputQty.value.trim() : '';
      const statusBox = document.getElementById('closecall-order-status');

      if (!pxVal || isNaN(parseFloat(pxVal))) {
        _toast('Please enter a valid price.', 'error');
        return;
      }
      if (!qtyVal || isNaN(parseFloat(qtyVal))) {
        _toast('Please enter a valid quantity.', 'error');
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Signing & broadcasting offer...';
      if (statusBox) statusBox.style.display = 'none';

      try {
        const res = await createAndBroadcastOffer(_nacl || window.nacl, _state.keypair, {
          side: closeCallState.selectedSide,
          px: pxVal,
          qty: qtyVal,
          untilSweeps: 24
        });

        _toast(`Offer broadcasted to /r/${CLOSE_CALL_CONFIG.roomTrade}!`, 'success');
        if (statusBox) {
          statusBox.className = 'result-callout success';
          statusBox.style.display = 'block';
          statusBox.innerHTML = `
            <div style="font-weight:700; margin-bottom: 4px;">✓ Order Offer Broadcasted!</div>
            <div style="font-size: 0.78rem;">Trade ID: <code>${res.terms.id}</code> | Maker Sig: <code>${res.makerSig.substring(0, 20)}...</code></div>
          `;
        }
        // Refresh feed immediately
        await refreshCloseCallData();
      } catch (err) {
        _toast(`Offer error: ${err.message}`, 'error');
        if (statusBox) {
          statusBox.className = 'result-callout error';
          statusBox.style.display = 'block';
          statusBox.textContent = err.message;
        }
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '⚡ Sign & Broadcast Trade Offer';
      }
    });
  }

  // Bind Refresh Feed button
  const btnRefresh = document.getElementById('btn-closecall-refresh-feed');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      btnRefresh.textContent = 'Refreshing...';
      try {
        await refreshCloseCallData();
        _toast('Close Call order book & feeds updated.', 'info');
      } finally {
        btnRefresh.disabled = false;
        btnRefresh.textContent = '🔄 Refresh';
      }
    });
  }

  // Start 1-second countdown clock for 5-minute referee sweeps
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(updateCountdownClock, 1000);
  updateCountdownClock();

  // Start periodic background data polling
  if (_dataTimer) clearInterval(_dataTimer);
  _dataTimer = setInterval(() => {
    if (_state && _state.activeView === 'closecall') {
      refreshCloseCallData();
    }
  }, 12000);

  // Initial trigger
  refreshCloseCallData();
}

/**
 * Calculates tied collateral and 1% referee fee dynamically based on input values
 */
function recalculateOrderSummary() {
  const inputPx = document.getElementById('closecall-input-px');
  const inputQty = document.getElementById('closecall-input-qty');
  const calcCost = document.getElementById('closecall-calc-cost');
  const calcFee = document.getElementById('closecall-calc-fee');

  const px = parseFloat(inputPx ? inputPx.value : 0) || 0;
  const qty = parseFloat(inputQty ? inputQty.value : 0) || 0;

  const cost = px * qty;
  const fee = cost * 0.01;

  if (calcCost) {
    calcCost.textContent = `${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} POLF`;
  }
  if (calcFee) {
    calcFee.textContent = `${fee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} POLF`;
  }
}

/**
 * Update 5-minute referee sweep countdown clock
 */
function updateCountdownClock() {
  const countdownEl = document.getElementById('closecall-countdown-display');
  if (!countdownEl) return;

  const now = new Date();
  const currentSeconds = now.getMinutes() * 60 + now.getSeconds();
  const secondsRemaining = 300 - (currentSeconds % 300);
  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  countdownEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Refresh all live data feeds for Close Call
 */
export async function refreshCloseCallData() {
  const did = _state && _state.keypair ? _state.keypair.did : null;
  await Promise.allSettled([
    fetchCloseCallPrice(),
    fetchCloseCallOrders(did),
    fetchCloseCallPnl(),
    fetchCloseCallFlow()
  ]);
  updateCloseCallUI();
}

/**
 * Update all DOM elements with the current closeCallState
 */
export function updateCloseCallUI() {
  // Active DID and Bankroll
  const activeDidEl = document.getElementById('closecall-active-did');
  if (activeDidEl) {
    if (_state && _state.keypair && _state.keypair.did) {
      activeDidEl.textContent = _state.keypair.did;
      activeDidEl.style.color = 'var(--brand-accent)';
    } else {
      activeDidEl.textContent = 'No key loaded. Please generate or restore key in Identity Setup.';
      activeDidEl.style.color = 'var(--text-muted)';
    }
  }

  // Reference Price & Limits
  const refPriceEl = document.getElementById('closecall-ref-price');
  const priceTimeEl = document.getElementById('closecall-price-time');
  const limitsEl = document.getElementById('closecall-limits-display');
  const sweepEl = document.getElementById('closecall-sweep-display');
  const priceHintEl = document.getElementById('closecall-price-hint');
  const inputPx = document.getElementById('closecall-input-px');

  if (refPriceEl) {
    if (closeCallState.referencePrice !== null) {
      refPriceEl.textContent = `$${closeCallState.referencePrice.toFixed(2)}`;
      if (inputPx && (!inputPx.value || inputPx.value === '224.70')) {
        inputPx.value = closeCallState.referencePrice.toFixed(2);
        recalculateOrderSummary();
      }
    } else {
      refPriceEl.textContent = 'Connecting...';
    }
  }

  if (priceTimeEl && closeCallState.priceTime) {
    priceTimeEl.textContent = `Hyperliquid: ${new Date(closeCallState.priceTime).toLocaleTimeString()}`;
  }

  if (limitsEl && closeCallState.limits) {
    limitsEl.textContent = `$${closeCallState.limits[0].toFixed(2)} – $${closeCallState.limits[1].toFixed(2)}`;
  }

  if (priceHintEl && closeCallState.limits) {
    priceHintEl.textContent = `Allowed: $${closeCallState.limits[0].toFixed(2)} – $${closeCallState.limits[1].toFixed(2)}`;
  }

  if (sweepEl) {
    sweepEl.textContent = `Sweep #${closeCallState.currentSweep || '--'}`;
  }

  // Render Open Offers
  renderOffersList();

  // Render Leaderboard
  renderLeaderboardList();
}

/**
 * Render Peer-to-Peer Order Book
 */
function renderOffersList() {
  const container = document.getElementById('closecall-offers-list');
  if (!container) return;

  const offers = closeCallState.openOffers || [];
  if (offers.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 28px 16px; color: var(--text-muted); font-size: 0.8125rem;">
        No active counterparty offers in <code>/r/${CLOSE_CALL_CONFIG.roomTrade}</code>.<br>
        Create the first offer above to start peer-to-peer trading!
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  offers.forEach((offer) => {
    const t = offer.terms;
    const isBuy = t.side === 'buy';
    const totalPolf = (parseFloat(t.px) * parseFloat(t.qty)).toFixed(2);
    const shortMaker = t.maker ? `${t.maker.substring(0, 14)}...${t.maker.substring(t.maker.length - 6)}` : 'Unknown';

    const card = document.createElement('div');
    card.className = `closecall-offer-card side-${t.side}`;
    card.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge ${isBuy ? 'badge-success' : 'badge-danger'}" style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase;">
            ${isBuy ? '🟢 BUY' : '🔴 SELL'}
          </span>
          <span style="font-family: var(--font-mono); font-weight: 800; font-size: 1.05rem; color: var(--text-primary);">
            $${t.px}
          </span>
          <span style="font-size: 0.78rem; color: var(--text-secondary);">
            × ${t.qty} contracts
          </span>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
          <span>Maker: <code style="color: var(--brand-accent); font-size: 0.6875rem;">${shortMaker}</code></span>
          <span>•</span>
          <span>Expires: Sweep #${t.until}</span>
          ${offer.isOwn ? '<span class="badge" style="background: rgba(32, 231, 242, 0.15); color: #20E7F2; font-size: 0.625rem;">YOU</span>' : ''}
        </div>
      </div>

      <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
        <span style="font-family: var(--font-mono); font-size: 0.875rem; font-weight: 700; color: var(--text-primary);">
          ${parseFloat(totalPolf).toLocaleString()} POLF
        </span>
        ${
          !offer.isOwn
            ? `<button class="btn btn-secondary btn-sm btn-take-order" style="padding: 4px 10px; font-size: 0.75rem; font-weight: 700; border-color: ${isBuy ? '#EF4444' : '#10B981'}; color: ${isBuy ? '#EF4444' : '#10B981'};">
                ⚡ Take Order (${isBuy ? 'Sell' : 'Buy'})
               </button>`
            : `<span style="font-size: 0.6875rem; color: var(--text-muted);">Your Order</span>`
        }
      </div>
    `;

    // Bind Take Order
    const takeBtn = card.querySelector('.btn-take-order');
    if (takeBtn) {
      takeBtn.addEventListener('click', async () => {
        if (!_state.keypair || !_state.keypair.did) {
          _toast('Please load your identity to take this order.', 'error');
          return;
        }
        takeBtn.disabled = true;
        takeBtn.textContent = 'Counter-signing...';
        try {
          await acceptAndExecuteOffer(_nacl || window.nacl, _state.keypair, offer);
          _toast(`Trade matched! Counter-signed & broadcasted to /r/${CLOSE_CALL_CONFIG.roomTrade}`, 'success');
          await refreshCloseCallData();
        } catch (err) {
          _toast(`Take order failed: ${err.message}`, 'error');
        } finally {
          takeBtn.disabled = false;
          takeBtn.textContent = `⚡ Take Order (${isBuy ? 'Sell' : 'Buy'})`;
        }
      });
    }

    container.appendChild(card);
  });
}

/**
 * Render Referee PnL Leaderboard
 */
function renderLeaderboardList() {
  const container = document.getElementById('closecall-leaderboard-list');
  if (!container) return;

  const top = closeCallState.topPnl || [];
  if (top.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px 16px; color: var(--text-muted); font-size: 0.8125rem;">
        Connecting to referee rankings in <code>/r/${CLOSE_CALL_CONFIG.roomPnl}</code>...
      </div>
    `;
    return;
  }

  let html = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Trader DID</th>
          <th style="text-align: right;">Net PnL</th>
          <th style="text-align: right;">Balance</th>
        </tr>
      </thead>
      <tbody>
  `;

  top.slice(0, 10).forEach((entry, idx) => {
    const rank = idx + 1;
    const rankMedal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const did = entry.key || entry.did || 'Unknown';
    const shortDid = did.length > 20 ? `${did.substring(0, 12)}...${did.substring(did.length - 6)}` : did;
    const pnl = entry.pnl !== undefined ? parseFloat(entry.pnl) : (parseFloat(entry.bal || 10000) - 10000);
    const bal = entry.bal !== undefined ? parseFloat(entry.bal) : 10000;
    const pnlColor = pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const pnlSign = pnl > 0 ? '+' : '';

    html += `
      <tr>
        <td style="font-weight: 800; font-size: 0.875rem;">${rankMedal}</td>
        <td>
          <code style="font-size: 0.72rem; color: var(--brand-accent);" title="${did}">${shortDid}</code>
        </td>
        <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: ${pnlColor};">
          ${pnlSign}${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} POLF
        </td>
        <td style="text-align: right; font-family: var(--font-mono); color: var(--text-secondary);">
          ${bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}
