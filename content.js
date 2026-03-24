// content.js
(function() {
  'use strict';

  let floatingUI = null;
  let lastParsed = null;

  // ── UI ─────────────────────────────────────────────────────────────────────

  function createUI() {
    const el = document.createElement('div');
    el.id = '__numis_resolver__';
    el.innerHTML = `
      <div class="numis-label">🏛️ Provenance</div>
      <div class="numis-buttons">
        <button class="numis-btn numis-nb" title="Open lot on NumisBids">NumisBids</button>
        <button class="numis-btn numis-ac" title="Search on ACSearch">ACSearch</button>
      </div>
    `;
    el.querySelector('.numis-nb').addEventListener('mousedown', e => { e.preventDefault(); onNBClick(); });
    el.querySelector('.numis-ac').addEventListener('mousedown', e => { e.preventDefault(); onACClick(); });
    document.body.appendChild(el);
    return el;
  }

  function showUI(x, y, parsed) {
    if (!floatingUI) floatingUI = createUI();
    lastParsed = parsed;

    // Reset button states
    const nbBtn = floatingUI.querySelector('.numis-nb');
    const acBtn = floatingUI.querySelector('.numis-ac');
    nbBtn.textContent = 'NumisBids';
    nbBtn.disabled = false;
    nbBtn.classList.remove('numis-loading', 'numis-found', 'numis-notfound');
    acBtn.textContent = 'ACSearch';
    acBtn.disabled = false;
    acBtn.classList.remove('numis-loading', 'numis-found', 'numis-notfound');

    floatingUI.style.left = `${x}px`;
    floatingUI.style.top  = `${y - 52}px`;
    floatingUI.style.display = 'block';

    // Kick off background resolution immediately so results are ready when clicked
    prefetch(parsed);
  }

  function hideUI() {
    if (floatingUI) floatingUI.style.display = 'none';
    lastParsed = null;
    pendingResolution = null;
  }

  // ── PREFETCH ───────────────────────────────────────────────────────────────

  let pendingResolution = null;  // Promise<{nb, ac}>

  function prefetch(parsed) {
    pendingResolution = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RESOLVE_LOT', parsed }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[NumisResolver]', chrome.runtime.lastError.message);
          resolve({ nb: { saleId: null }, ac: { companyId: null, auctionId: null } });
          return;
        }
        resolve(response || { nb: { saleId: null }, ac: { companyId: null, auctionId: null } });
      });
    });
  }

  // ── BUTTON CLICKS ──────────────────────────────────────────────────────────

  async function onNBClick() {
    if (!lastParsed) return;
    const btn = floatingUI.querySelector('.numis-nb');
    btn.textContent = '⏳';
    btn.disabled = true;

    const { nb } = await pendingResolution;

    if (nb?.saleId) {
      const url = `https://www.numisbids.com/sale/${nb.saleId}/lot/${lastParsed.lotNumber}`;
      window.open(url, '_blank');
      btn.textContent = '✓ NumisBids';
      btn.classList.add('numis-found');
    } else {
      // Fall back to Google search
      const url = buildNBGoogleFallback(lastParsed);
      window.open(url, '_blank');
      btn.textContent = '? NumisBids';
      btn.classList.add('numis-notfound');
    }
    btn.disabled = false;
  }

  async function onACClick() {
    if (!lastParsed) return;
    const btn = floatingUI.querySelector('.numis-ac');
    btn.textContent = '⏳';
    btn.disabled = true;

    const { ac } = await pendingResolution;
    const url = buildACSearchUrl(lastParsed, ac);
    window.open(url, '_blank');

    if (ac?.auctionId) {
      btn.textContent = '✓ ACSearch';
      btn.classList.add('numis-found');
    } else if (ac?.companyId) {
      btn.textContent = '~ ACSearch';
      btn.classList.add('numis-notfound');
    } else {
      btn.textContent = 'ACSearch ↗';
    }
    btn.disabled = false;
  }

  // ── URL BUILDERS ───────────────────────────────────────────────────────────

  function buildACSearchUrl(parsed, ac) {
    const params = new URLSearchParams({ term: '', en: 1, de: 1, fr: 1, it: 1, es: 1, ot: 1 });

    if (ac?.auctionId && ac?.companyId) {
      // Best case: exact auction + lot
      params.set('company', ac.companyId);
      params.set('auction', ac.auctionId);
      params.set('lot', parsed.lotNumber);
    } else if (ac?.companyId) {
      // Know the company but not the specific auction — filter by company + year
      params.set('company', ac.companyId);
      params.set('lot', parsed.lotNumber);
      if (parsed.year) {
        params.set('date_from', `${parsed.year}-01-01`);
        params.set('date_to', `${parsed.year}-12-31`);
      }
    } else {
      // Unknown company — fall back to text search with house name
      const houseTerm = parsed.house.replace(/\s*&\s*/g, ' ').trim();
      const salePart = parsed.saleNumber != null ? ` ${parsed.saleNumber}` : '';
      params.set('term', `${houseTerm}${salePart}`);
    }

    return `https://www.acsearch.info/search.html?${params.toString()}`;
  }

  function buildNBGoogleFallback(parsed) {
    const h = parsed.house.replace(/[&'.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = [`site:numisbids.com`, `"${h}"`];
    if (parsed.saleNumber != null) parts.push(`"${parsed.saleRaw || parsed.saleNumber}"`);
    else if (parsed.dateStr) parts.push(`"${parsed.dateStr}"`);
    if (parsed.year) parts.push(`"${parsed.year}"`);
    return `https://www.google.com/search?q=${encodeURIComponent(parts.join(' '))}`;
  }

  // ── SELECTION DETECTION ────────────────────────────────────────────────────

  // Snapshot of the last valid parsed selection, with its screen rect.
  // Captured on mouseup so it survives pages (like ACSearch) that collapse
  // the selection on the subsequent mousedown when opening a sidebar.
  let lastParsedSnapshot = null;

  function tryShowFromSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return false;
    const text = sel.toString().trim();
    if (text.length < 6 || text.length > 120) return false;
    const parsed = window.NumisParser.parseProvenance(text);
    if (!parsed) return false;
    const range = sel.getRangeAt(0);
    const rect  = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    const x = rect.left + window.scrollX + rect.width / 2 - 70;
    const y = rect.top  + window.scrollY;
    lastParsedSnapshot = { parsed, x, y };
    showUI(x, y, parsed);
    return true;
  }

  // mouseup: capture snapshot SYNCHRONOUSLY so it's available before ACSearch's
  // own mousedown handler fires and collapses the selection
  document.addEventListener('mouseup', (e) => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!sel || sel.isCollapsed || text.length < 6 || text.length > 120) {
      lastParsedSnapshot = null;
      setTimeout(hideUI, 10);
      return;
    }
    const parsed = window.NumisParser.parseProvenance(text);
    if (parsed) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const x = rect.left + window.scrollX + rect.width / 2 - 70;
      const y = rect.top + window.scrollY;
      lastParsedSnapshot = { parsed, x, y };
      showUI(x, y, parsed);
    } else {
      lastParsedSnapshot = null;
      setTimeout(hideUI, 10);
    }
  });

  // selectionchange: catches keyboard selections
  let selectionDebounce = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionDebounce);
    selectionDebounce = setTimeout(() => tryShowFromSelection(), 200);
  });

  document.addEventListener('mousedown', (e) => {
    if (floatingUI && e.target.closest('#__numis_resolver__')) return;

    const sel = window.getSelection();
    const clickedInsideSelection = sel && !sel.isCollapsed &&
      sel.containsNode(e.target, true);
    if (clickedInsideSelection && lastParsedSnapshot) {
      // Don't hide — the sidebar opening will collapse the selection but
      // our snapshot is valid. Re-show from snapshot after a short delay
      // in case the page moves things around.
      setTimeout(() => {
        if (floatingUI) return; // still visible, nothing to do
        const { parsed, x, y } = lastParsedSnapshot;
        showUI(x, y, parsed);
      }, 150);
      return;
    }

    lastParsedSnapshot = null;
    hideUI();
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideUI(); });

})();
