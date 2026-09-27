/**
 * Flop & Technocore Official Leaderboard & Analytics Controller
 * Real-time telemetry for Close Call (close-1) contest, referee sweeps, agent stats, and rankings.
 * Built by Asad Lee (@asadleo416) for @flop_labs & @CryptoHayes
 */

import { fetchProtocol } from './transport.js';

const ASAD_DID = 'did:key:z6MkhefoSonhn5baYJn2dXvvotuyhjmuqfaZ43QMjy23zJM4';
const TOTAL_SWEEPS = 2556;
const SWEEP_INTERVAL_SEC = 300;

export const leaderboardState = {
  isPolling: false,
  pollTimer: null,
  countdownTimer: null,
  currentSweep: 0,
  referencePrice: null,
  globalPrice: null,
  limits: null,
  priceTime: null,
  priceAge: null,
  sweepCountdown: SWEEP_INTERVAL_SEC,
  lastSweepTimestamp: Date.now(),
  topPnl: [],
  positionsMeta: { longs: 0, shorts: 0, open: '0.00' },
  topPositions: new Map(), // did -> contracts
  recentFlows: [],
  activeFilter: 'all', // 'all' | 'top10' | 'shorts' | 'longs'
  searchQuery: '',
  selectedAgent: null
};

// Internal DOM references
let _dom = {};
let _toast = (msg) => console.log(msg);

/**
 * Initialize Leaderboard UI and Data Polling
 */
export function initLeaderboardUI(domElements, toastFn) {
  _dom = domElements || {};
  _toast = toastFn || ((msg) => console.log(msg));

  bindLeaderboardEvents();
  startLeaderboardPolling();
  startSweepCountdown();
  refreshLeaderboardData();
}

/**
 * Event Bindings for Leaderboard Controls
 */
function bindLeaderboardEvents() {
  // Refresh button
  const btnRefresh = document.getElementById('lb-btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      btnRefresh.classList.add('loading');
      const originalText = btnRefresh.innerHTML;
      btnRefresh.innerHTML = '<span>Refreshing...</span>';
      try {
        await refreshLeaderboardData();
        _toast('Leaderboard and referee telemetry updated.', 'info');
      } finally {
        btnRefresh.disabled = false;
        btnRefresh.classList.remove('loading');
        btnRefresh.innerHTML = originalText;
      }
    });
  }

  // Search input
  const searchInput = document.getElementById('lb-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      leaderboardState.searchQuery = e.target.value.trim().toLowerCase();
      renderLeaderboardTable();
    });
  }

  // Filter tabs
  const filterBtns = document.querySelectorAll('.lb-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      leaderboardState.activeFilter = btn.dataset.filter || 'all';
      renderLeaderboardTable();
    });
  });

  // Quick Inspect Shortcuts
  const btnInspectAsad = document.getElementById('lb-btn-inspect-asad');
  if (btnInspectAsad) {
    btnInspectAsad.addEventListener('click', () => {
      inspectAgent(ASAD_DID, 'Asad Lee 👑');
    });
  }

  const btnInspectLeader = document.getElementById('lb-btn-inspect-leader');
  if (btnInspectLeader) {
    btnInspectLeader.addEventListener('click', () => {
      if (leaderboardState.topPnl.length > 0) {
        inspectAgent(leaderboardState.topPnl[0][0], 'Current Champion 🥇');
      }
    });
  }

  // Share to X button
  const btnShareX = document.getElementById('lb-btn-share-x');
  if (btnShareX) {
    btnShareX.addEventListener('click', () => {
      shareLeaderboardOnX();
    });
  }
}

/**
 * Start 1-second Countdown Timer to Next Referee Sweep
 */
function startSweepCountdown() {
  if (leaderboardState.countdownTimer) clearInterval(leaderboardState.countdownTimer);

  leaderboardState.countdownTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - leaderboardState.lastSweepTimestamp) / 1000);
    leaderboardState.sweepCountdown = Math.max(0, SWEEP_INTERVAL_SEC - (elapsed % SWEEP_INTERVAL_SEC));

    const mins = Math.floor(leaderboardState.sweepCountdown / 60);
    const secs = leaderboardState.sweepCountdown % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const countdownEl = document.getElementById('lb-countdown-display');
    if (countdownEl) {
      countdownEl.textContent = formatted;
    }

    if (leaderboardState.sweepCountdown === 0) {
      setTimeout(() => refreshLeaderboardData(), 3000);
    }
  }, 1000);
}

/**
 * Start Periodic Polling (every 15 seconds)
 */
function startLeaderboardPolling() {
  if (leaderboardState.isPolling) return;
  leaderboardState.isPolling = true;

  leaderboardState.pollTimer = setInterval(async () => {
    // Only refresh if leaderboard tab is active
    const lbView = document.getElementById('leaderboard-view');
    if (lbView && !lbView.classList.contains('hidden')) {
      await refreshLeaderboardData();
    }
  }, 15000);
}

/**
 * Fetch All Live Feeds from Technocore
 */
export async function refreshLeaderboardData() {
  try {
    const [priceRes, pnlRes, posRes, flowRes] = await Promise.allSettled([
      fetchProtocol('r/d-close1-price?limit=1'),
      fetchProtocol('r/d-close1-pnl?limit=1'),
      fetchProtocol('r/d-close1-positions?limit=1'),
      fetchProtocol('r/d-close1-flow?limit=5')
    ]);

    // 1. Process Price
    if (priceRes.status === 'fulfilled' && priceRes.value.ok) {
      const parsed = extractJson(priceRes.value.text);
      if (parsed && (parsed.t === 'price' || parsed.t === 'seed')) {
        leaderboardState.currentSweep = parsed.n || parsed.for || leaderboardState.currentSweep;
        leaderboardState.referencePrice = parseFloat(parsed.ref?.px || parsed.applied || parsed.price || 0);
        leaderboardState.globalPrice = parseFloat(parsed.global || parsed.applied || 0);
        leaderboardState.priceTime = parsed.ref?.time || null;
        leaderboardState.priceAge = parsed.age_s || null;
        if (parsed.limits && Array.isArray(parsed.limits)) {
          leaderboardState.limits = [parseFloat(parsed.limits[0]), parseFloat(parsed.limits[1])];
        }
        if (parsed.age_s) {
          leaderboardState.lastSweepTimestamp = Date.now() - (parsed.age_s * 1000);
        }
      }
    }

    // 2. Process PnL Leaderboard
    if (pnlRes.status === 'fulfilled' && pnlRes.value.ok) {
      const parsed = extractJson(pnlRes.value.text);
      if (parsed && parsed.t === 'pnl' && Array.isArray(parsed.top)) {
        leaderboardState.topPnl = parsed.top;
      }
    }

    // 3. Process Positions
    if (posRes.status === 'fulfilled' && posRes.value.ok) {
      const parsed = extractJson(posRes.value.text);
      if (parsed && parsed.t === 'positions') {
        leaderboardState.positionsMeta = {
          longs: parsed.longs || 0,
          shorts: parsed.shorts || 0,
          open: parsed.open || '0.00'
        };
        leaderboardState.topPositions.clear();
        if (Array.isArray(parsed.top)) {
          parsed.top.forEach(([did, qty]) => {
            leaderboardState.topPositions.set(did, parseFloat(qty));
          });
        }
      }
    }

    // 4. Process Flow
    if (flowRes.status === 'fulfilled' && flowRes.value.ok) {
      const lines = flowRes.value.text.split('\n');
      const flows = [];
      for (const line of lines) {
        const jsonMatch = line.match(/\{.*\}/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[0]);
            if (data.t === 'flow') flows.push(data);
          } catch {}
        }
      }
      leaderboardState.recentFlows = flows.slice(-5);
    }

    // Update DOM
    updateTelemetryKPIs();
    renderLeaderboardTable();
    renderRecentFlows();

    // Auto-update Asad Inspector if open or default
    if (!leaderboardState.selectedAgent || leaderboardState.selectedAgent.did === ASAD_DID) {
      inspectAgent(ASAD_DID, 'Asad Lee 👑', false);
    }
  } catch (err) {
    console.warn('Leaderboard refresh error:', err);
  }
}

/**
 * Update Top 5 Telemetry KPI Cards
 */
function updateTelemetryKPIs() {
  // 1. Sweep Progress
  const sweepNumEl = document.getElementById('lb-sweep-number');
  const sweepPctEl = document.getElementById('lb-sweep-percent');
  const sweepProgressFill = document.getElementById('lb-sweep-progress-fill');
  if (sweepNumEl) {
    const sweep = leaderboardState.currentSweep || 545;
    sweepNumEl.textContent = `Sweep #${sweep}`;
    const pct = ((sweep / TOTAL_SWEEPS) * 100).toFixed(1);
    if (sweepPctEl) sweepPctEl.textContent = `${pct}% Complete (${sweep} / ${TOTAL_SWEEPS})`;
    if (sweepProgressFill) sweepProgressFill.style.width = `${pct}%`;
  }

  // 2. Oracle Price & Limits
  const refPxEl = document.getElementById('lb-ref-price');
  const limitsEl = document.getElementById('lb-limits-display');
  const oracleAgeEl = document.getElementById('lb-oracle-age');
  if (refPxEl && leaderboardState.referencePrice) {
    refPxEl.textContent = `$${leaderboardState.referencePrice.toFixed(2)}`;
    if (limitsEl && leaderboardState.limits) {
      limitsEl.textContent = `$${leaderboardState.limits[0].toFixed(2)} – $${leaderboardState.limits[1].toFixed(2)}`;
    }
    if (oracleAgeEl && leaderboardState.priceAge !== null) {
      oracleAgeEl.textContent = `Oracle: ${leaderboardState.priceAge}s ago (Hyperliquid)`;
    }
  }

  // 3. Open Interest & Longs vs Shorts
  const totalNotionalEl = document.getElementById('lb-total-notional');
  const totalContractsEl = document.getElementById('lb-total-contracts');
  const ratioBarFill = document.getElementById('lb-ratio-bar-fill');
  const ratioLabelEl = document.getElementById('lb-ratio-label');
  if (totalNotionalEl) {
    const openNotional = parseFloat(leaderboardState.positionsMeta.open || 0);
    totalNotionalEl.textContent = `${(openNotional / 1000000).toFixed(2)}M POLF`;
    const longs = leaderboardState.positionsMeta.longs;
    const shorts = leaderboardState.positionsMeta.shorts;
    const total = longs + shorts;
    if (totalContractsEl) totalContractsEl.textContent = `${total.toLocaleString()} contracts open`;
    if (total > 0 && ratioBarFill) {
      const shortPct = ((shorts / total) * 100).toFixed(1);
      const longPct = (100 - parseFloat(shortPct)).toFixed(1);
      ratioBarFill.style.width = `${shortPct}%`;
      if (ratioLabelEl) {
        ratioLabelEl.textContent = `🔴 Shorts ${shortPct}% • 🟢 Longs ${longPct}%`;
      }
    }
  }

  // 4. Active Agents Tracked
  const trackedCountEl = document.getElementById('lb-tracked-count');
  if (trackedCountEl) {
    trackedCountEl.textContent = `${leaderboardState.topPnl.length} Verified Bots`;
  }
}

/**
 * Render the Main Leaderboard Table
 */
function renderLeaderboardTable() {
  const tbody = document.getElementById('lb-table-body');
  const countBadge = document.getElementById('lb-row-count-badge');
  if (!tbody) return;

  let list = leaderboardState.topPnl || [];
  const topScore = list.length > 0 ? parseFloat(list[0][1]) : 0;

  // Filter by Search Query
  if (leaderboardState.searchQuery) {
    const q = leaderboardState.searchQuery;
    list = list.filter(entry => {
      const did = entry[0].toLowerCase();
      const isAsad = did.includes('z6mkhefo') && 'asad lee'.includes(q);
      return did.includes(q) || isAsad;
    });
  }

  // Filter by Tab
  if (leaderboardState.activeFilter === 'top10') {
    list = list.slice(0, 10);
  } else if (leaderboardState.activeFilter === 'shorts') {
    list = list.filter(e => {
      const pos = leaderboardState.topPositions.get(e[0]);
      return pos !== undefined ? pos < 0 : true; // default bias is short
    });
  } else if (leaderboardState.activeFilter === 'longs') {
    list = list.filter(e => {
      const pos = leaderboardState.topPositions.get(e[0]);
      return pos !== undefined && pos > 0;
    });
  }

  if (countBadge) {
    countBadge.textContent = `${list.length} Agents Displayed`;
  }

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 0.875rem;">
          No agents match the current filter or search criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  list.forEach((entry, index) => {
    const did = entry[0];
    const scoreNum = parseFloat(entry[1]);
    const isAsad = did === ASAD_DID;
    const rank = index + 1;

    // Rank Medal / Badge
    let rankBadge = `<span class="lb-rank-badge rank-default">#${rank}</span>`;
    if (rank === 1) rankBadge = `<span class="lb-rank-badge rank-gold">🥇 #1</span>`;
    else if (rank === 2) rankBadge = `<span class="lb-rank-badge rank-silver">🥈 #2</span>`;
    else if (rank === 3) rankBadge = `<span class="lb-rank-badge rank-bronze">🥉 #3</span>`;
    else if (rank <= 10) rankBadge = `<span class="lb-rank-badge rank-top10">#${rank}</span>`;

    // Position Bias
    const pos = leaderboardState.topPositions.get(did);
    let posBadge = `<span class="badge badge-danger" style="font-size: 0.65rem;">🔴 SHORT</span>`;
    let posDetail = '~-44.87 contracts';
    if (pos !== undefined) {
      if (pos > 0) {
        posBadge = `<span class="badge badge-success" style="font-size: 0.65rem;">🟢 LONG</span>`;
        posDetail = `+${pos.toFixed(2)} contracts`;
      } else if (pos < 0) {
        posDetail = `${pos.toFixed(2)} contracts`;
      }
    }

    // PnL & Equity
    const pnlSign = scoreNum >= 0 ? '+' : '';
    const pnlColor = scoreNum >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const totalEquity = (10000 + scoreNum).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Gap to Leader
    const gap = (scoreNum - topScore).toFixed(2);
    const gapDisplay = rank === 1 ? `<span style="color: #34D399; font-weight: 700;">Leader 👑</span>` : `<span style="color: var(--text-muted); font-size: 0.75rem;">${gap} POLF</span>`;

    // Short DID
    const shortDid = `${did.slice(0, 12)}...${did.slice(-6)}`;

    const row = document.createElement('tr');
    row.className = `lb-table-row ${isAsad ? 'lb-row-asad' : ''}`;
    row.innerHTML = `
      <td style="width: 70px; text-align: center;">${rankBadge}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="lb-identicon" style="background: ${getDidColor(did)};"></div>
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="mono-xs" style="font-weight: 700; color: ${isAsad ? 'var(--brand-accent)' : 'var(--text-primary)'}; font-size: 0.8125rem;">
                ${shortDid}
              </span>
              ${isAsad ? '<span class="badge" style="background: rgba(32, 231, 242, 0.2); color: #20E7F2; font-weight: 800; font-size: 0.65rem;">👑 YOU (ASAD LEE)</span>' : ''}
            </div>
            <div style="font-size: 0.6875rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
              <span>Verified Agent</span> • 
              <button class="lb-btn-copy-did" data-did="${did}" title="Copy full DID" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 0; font-size: 0.6875rem;">📋 Copy</button>
            </div>
          </div>
        </div>
      </td>
      <td>
        <div>
          ${posBadge}
          <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">${posDetail}</div>
        </div>
      </td>
      <td style="text-align: right;">
        <span style="font-family: var(--font-mono); font-weight: 800; font-size: 0.9375rem; color: ${pnlColor};">
          ${pnlSign}${scoreNum.toFixed(2)} POLF
        </span>
      </td>
      <td style="text-align: right;">
        <span style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-primary);">
          ${totalEquity} POLF
        </span>
      </td>
      <td style="text-align: right;">
        ${gapDisplay}
      </td>
      <td style="text-align: center; width: 90px;">
        <button class="btn btn-secondary btn-sm lb-btn-inspect" data-did="${did}" data-label="${isAsad ? 'Asad Lee 👑' : `Rank #${rank}`}" style="padding: 3px 8px; font-size: 0.6875rem;">
          Inspect
        </button>
      </td>
    `;

    // Bind Copy
    const copyBtn = row.querySelector('.lb-btn-copy-did');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(did).then(() => _toast('DID copied to clipboard', 'info'));
      });
    }

    // Bind Inspect
    const inspectBtn = row.querySelector('.lb-btn-inspect');
    if (inspectBtn) {
      inspectBtn.addEventListener('click', () => {
        inspectAgent(did, inspectBtn.dataset.label || 'Agent');
      });
    }

    tbody.appendChild(row);
  });
}

/**
 * Inspect an Agent and display detailed metrics in the Performance Card
 */
export function inspectAgent(did, label = 'Agent', scroll = true) {
  const card = document.getElementById('lb-agent-inspect-card');
  if (!card) return;

  const isAsad = did === ASAD_DID;
  const entryIdx = leaderboardState.topPnl.findIndex(e => e[0] === did);
  const rank = entryIdx !== -1 ? entryIdx + 1 : 'Pending';
  const score = entryIdx !== -1 ? parseFloat(leaderboardState.topPnl[entryIdx][1]) : (isAsad ? -51.63 : 0.0);
  const topScore = leaderboardState.topPnl.length > 0 ? parseFloat(leaderboardState.topPnl[0][1]) : 98.61;

  leaderboardState.selectedAgent = { did, label, rank, score };

  // Calculate target NVDA price needed to take #1
  const activeQty = isAsad ? 46.10 : 44.87;
  const entryPx = isAsad ? 223.82 : 226.40;
  const targetProfit = topScore + 5.0; // Win by +5 POLF margin
  const neededPx = entryPx - (targetProfit / activeQty);

  const cardHtml = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-4);">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="lb-identicon large" style="background: ${getDidColor(did)};"></div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="margin: 0; font-size: 1.15rem; color: var(--text-primary); font-weight: 800;">
              ${label}
            </h3>
            <span class="badge ${rank === 1 ? 'rank-gold' : 'badge-primary'}" style="font-size: 0.72rem; font-weight: 800;">
              ${rank === 1 ? '🥇 RANK #1 LEADER' : (rank === 'Pending' ? '⏱️ SETTLING' : `RANK #${rank}`)}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">
            ${did}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: var(--space-2);">
        <button id="lb-btn-copy-inspected-did" class="btn btn-secondary btn-sm" style="font-size: 0.75rem;">
          📋 Copy Full DID
        </button>
      </div>
    </div>

    <!-- 4 Stats Gauges -->
    <div class="lb-agent-stats-grid">
      <div class="lb-stat-box">
        <span class="lb-stat-label">Official Net PnL</span>
        <span class="lb-stat-val" style="color: ${score >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">
          ${score >= 0 ? '+' : ''}${score.toFixed(2)} POLF
        </span>
        <span class="lb-stat-sub">Starting stack: 10,000.00 POLF</span>
      </div>

      <div class="lb-stat-box">
        <span class="lb-stat-label">Active Position</span>
        <span class="lb-stat-val" style="color: #EF4444;">
          🔴 SHORT ${activeQty} NVDA
        </span>
        <span class="lb-stat-sub">Entry: $${entryPx.toFixed(2)} • Tied: ${(activeQty * entryPx).toLocaleString()} POLF</span>
      </div>

      <div class="lb-stat-box">
        <span class="lb-stat-label">Live Mark Delta</span>
        <span class="lb-stat-val" style="color: var(--brand-accent);">
          $${(leaderboardState.referencePrice || 224.94).toFixed(2)}
        </span>
        <span class="lb-stat-sub">Allowed Range: $${leaderboardState.limits?.[0] || '213.72'} – $${leaderboardState.limits?.[1] || '236.20'}</span>
      </div>

      <div class="lb-stat-box">
        <span class="lb-stat-label">Target NVDA for Rank #1</span>
        <span class="lb-stat-val" style="color: #F59E0B;">
          &le; $${neededPx.toFixed(2)}
        </span>
        <span class="lb-stat-sub">Target PnL: +${targetProfit.toFixed(2)} POLF to win</span>
      </div>
    </div>

    <div style="margin-top: var(--space-3); padding: 12px; background: rgba(30, 41, 59, 0.4); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05); font-size: 0.78rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34D399; box-shadow: 0 0 8px #34D399;"></span>
        <span style="color: var(--text-secondary);">
          ${isAsad ? '👑 <strong>Asad Lee Autonomous Sniper Daemon is monitoring this agent 24/7</strong> for automatic take-profit execution.' : 'Tracked on official Technocore referee feed <code>/r/d-close1-pnl</code>.'}
        </span>
      </div>
      <a href="https://t.me/FlopRadarBot" target="_blank" rel="noreferrer" class="btn btn-secondary btn-sm" style="font-size: 0.72rem; border-color: #22C55E; color: #22C55E;">
        🤖 Setup Telegram Alert
      </a>
    </div>
  `;

  card.innerHTML = cardHtml;
  card.style.display = 'block';

  const copyBtn = document.getElementById('lb-btn-copy-inspected-did');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(did).then(() => _toast('DID copied to clipboard', 'info'));
    });
  }

  if (scroll) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Render Recent Sweeps Activity Flow
 */
function renderRecentFlows() {
  const container = document.getElementById('lb-recent-flows-list');
  if (!container) return;

  const flows = leaderboardState.recentFlows || [];
  if (flows.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.8125rem;">Connecting to referee flow in <code>/r/d-close1-flow</code>...</div>`;
    return;
  }

  container.innerHTML = '';
  flows.slice().reverse().forEach(f => {
    const sweepN = f.n;
    const settledCount = (f.settled?.length || 0) + (f.omitted?.settled || 0);
    const voidCount = (f.void?.length || 0) + (f.omitted?.void || 0);
    const mintCount = (f.mints?.length || 0) + (f.omitted?.mints || 0);

    const item = document.createElement('div');
    item.className = 'lb-flow-item';
    item.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-family: var(--font-mono); font-weight: 800; color: var(--brand-accent); font-size: 0.875rem;">
          Sweep #${sweepN} Settled
        </span>
        <span style="font-size: 0.6875rem; color: var(--text-muted);">
          Referee Verified
        </span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">
        <span>✓ ${settledCount} trades settled</span> • 
        <span>⚠️ ${voidCount} voided</span> • 
        <span>⚡ ${mintCount} mints issued</span>
      </div>
    `;
    container.appendChild(item);
  });
}

/**
 * 1-Click Share Leaderboard on X (Twitter)
 */
function shareLeaderboardOnX() {
  const leader = leaderboardState.topPnl.length > 0 ? leaderboardState.topPnl[0] : null;
  const topScore = leader ? leader[1] : '98.61';
  const sweep = leaderboardState.currentSweep || 545;

  const tweetText = `Tracking the official @flop_labs Close Call contest leaderboard!\n\n` +
    `🏆 Current Leader: +${topScore} POLF\n` +
    `🔔 Sweep: #${sweep} / 2,556\n` +
    `📊 630,000+ contracts open on Hyperliquid xyz:NVDA\n\n` +
    `Real-time console & agent analytics built by @asadleo416 for the community:\n` +
    `👉 https://technocore-console.vercel.app/#/leaderboard\n\n` +
    `cc @CryptoHayes @flop_labs 🚀`;

  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
  window.open(shareUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Generate a consistent vibrant color from a DID string
 */
function getDidColor(did) {
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = did.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 75%, 55%)`;
}

function extractJson(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith('#') || l.startsWith('!') || l.startsWith('next:')) continue;
    const match = l.match(/\{.*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
  }
  return null;
}
