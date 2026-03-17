// biddr_fees.js
// Runs on biddr.com live auction and auction detail pages.
// Prompts user to set buyer's premium on first visit, then injects
// with-premium estimates next to bid amounts.

(function () {
  'use strict';

  const isLivePage    = /\/live/.test(location.pathname)    && /[?&]a=\d+/.test(location.search);
  const isAuctionPage = /\/auction/.test(location.pathname) && /[?&]a=\d+/.test(location.search);
  if (!isLivePage && !isAuctionPage) return;

  const pageId  = (location.search.match(/[?&]a=(\d+)/) || [])[1];
  // Key includes the house slug so SPQR's live 10541 ≠ another house's live 10541
  const slug    = location.pathname.split('/')[1];         // e.g. "spqrcollection"
  const cacheKey = `biddr_premium::${slug}::${pageId}`;
  const INJECTED = '__biddr_premium__';

  // ── CACHE ──────────────────────────────────────────────────────────────────

  async function getCached() {
    return new Promise(r => chrome.storage.local.get([cacheKey], d => {
      const v = d[cacheKey];
      r(v === undefined ? null : v);
    }));
  }
  async function setCache(pct) {
    return new Promise(r => chrome.storage.local.set({ [cacheKey]: pct }, r));
  }

  // ── PROMPT BANNER ──────────────────────────────────────────────────────────

  function showPrompt(currentPct, onSave) {
    if (document.getElementById('__biddr_prompt__')) return;

    const bar = document.createElement('div');
    bar.id = '__biddr_prompt__';
    bar.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
      background: #1a1a2e; color: #fff; font-family: sans-serif;
      font-size: 13px; padding: 8px 16px;
      display: flex; align-items: center; gap: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;

    const label = document.createElement('span');
    label.textContent = `NumisFees: Buyer's premium for this sale?`;
    label.style.flex = '1';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0'; input.max = '50'; input.step = '0.5';
    input.value = currentPct !== null ? currentPct : '';
    input.placeholder = 'e.g. 18';
    input.style.cssText = 'width:70px; padding:4px 6px; border-radius:4px; border:none; font-size:13px;';

    const pctLabel = document.createElement('span');
    pctLabel.textContent = '%';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `
      padding: 4px 14px; background: #00b4d8; color: #fff;
      border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
    `;

    const skipBtn = document.createElement('button');
    skipBtn.textContent = '✕';
    skipBtn.title = 'Dismiss (won\'t show again this session)';
    skipBtn.style.cssText = `
      padding: 4px 10px; background: transparent; color: #aaa;
      border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 13px;
    `;

    saveBtn.addEventListener('click', () => {
      const val = parseFloat(input.value);
      if (isNaN(val) || val < 0 || val > 50) {
        input.style.outline = '2px solid red';
        return;
      }
      bar.remove();
      onSave(val);
    });

    skipBtn.addEventListener('click', () => bar.remove());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });

    bar.append(label, input, pctLabel, saveBtn, skipBtn);
    document.body.prepend(bar);
    input.focus();
  }

  // ── INJECTION ──────────────────────────────────────────────────────────────

  function normVal(s) { return s.replace(/(\d)[^\dA-Z](\d)/g, '$1$2').trim(); }
  const valueRe = /^(\d+)\s+([A-Z]{3})$/;

  function formatWithPremium(amount, currency, pct) {
    return `${Math.round(amount * (1 + pct / 100)).toLocaleString()} ${currency}`;
  }

  function injectPrices(pct) {
    document.querySelectorAll('.' + INJECTED).forEach(el => el.remove());
    let injected = 0;

    // ── 1. Current bid (.current-bid) ────────────────────────────────────
    // Inject as a sibling AFTER .current-bid, not inside it — biddr replaces
    // the element's text content on each update which would destroy an inner span.
    document.querySelectorAll('.current-bid').forEach(el => {
      if (el.nextSibling?.classList?.contains(INJECTED)) return;
      const textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!textNode) return;
      const norm = normVal(textNode.textContent.trim());
      const m = norm.match(valueRe);
      if (!m) return;
      const amount = parseFloat(m[1]);
      const currency = m[2];
      if (isNaN(amount) || amount <= 0) return;
      const span = document.createElement('div');
      span.className = INJECTED;
      span.title = `${amount.toLocaleString()} ${currency} + ${pct}% buyer's premium`;
      span.textContent = `\u2192 ${formatWithPremium(amount, currency, pct)} (+${pct}%)`;
      span.style.cssText = 'color:#b8860b;font-size:0.85em;font-weight:normal;text-align:center;margin-top:2px;';
      el.parentNode.insertBefore(span, el.nextSibling);
      injected++;
    });

    // ── 2. Hammer prices on lot thumbnails (.hammer-price .sold) ─────────
    document.querySelectorAll('.hammer-price .sold').forEach(el => {
      if (el.querySelector('.' + INJECTED)) return;
      const textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!textNode) return;
      const norm = normVal(textNode.textContent.trim());
      const m = norm.match(valueRe);
      if (!m) return;
      const amount = parseFloat(m[1]);
      const currency = m[2];
      if (isNaN(amount) || amount <= 0) return;
      const span = document.createElement('span');
      span.className = INJECTED;
      span.title = `${amount.toLocaleString()} ${currency} + ${pct}% buyer's premium`;
      span.textContent = ` \u2192 ${formatWithPremium(amount, currency, pct)} (+${pct}%)`;
      span.style.cssText = 'color:#fff;font-size:0.85em;font-weight:normal;white-space:nowrap;';
      el.appendChild(span);
      injected++;
    });

    // ── 3. Lot page price amounts (.highlight-u) ──────────────────────────
    // Used on lot detail pages for current bid and estimate — same popover
    // currency-converter spans as on live pages but outside .current-bid.
    document.querySelectorAll('span.highlight-u').forEach(el => {
      if (el.closest('.bidder-account')) return;
      if (el.querySelector('.' + INJECTED)) return;
      const textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!textNode) return;
      const norm = normVal(textNode.textContent.trim());
      const m = norm.match(valueRe);
      if (!m) return;
      const amount = parseFloat(m[1]);
      const currency = m[2];
      if (isNaN(amount) || amount <= 0) return;
      const span = document.createElement('span');
      span.className = INJECTED;
      span.title = `${amount.toLocaleString()} ${currency} + ${pct}% buyer's premium`;
      span.textContent = ` \u2192 ${formatWithPremium(amount, currency, pct)} (+${pct}%)`;
      span.style.cssText = 'color:#b8860b;font-size:0.85em;font-weight:normal;white-space:nowrap;';
      el.appendChild(span);
      injected++;
    });

    // ── 2. Approximate currency conversions (.next-bid-converted) ─────────
    // Structure: <small class="next-bid-converted">\u2248 <b><span>14</span> USD</b>...</small>
    // The number and currency are split across child nodes, so read from the <b>.
    document.querySelectorAll('.next-bid-converted b').forEach(b => {
      if (b.querySelector('.' + INJECTED)) return;
      const text = normVal(b.textContent.trim());
      const m = text.match(valueRe);
      if (!m) return;
      const amount = parseFloat(m[1]);
      const currency = m[2];
      if (isNaN(amount) || amount <= 0) return;
      const span = document.createElement('span');
      span.className = INJECTED;
      span.title = `${amount.toLocaleString()} ${currency} + ${pct}% buyer's premium`;
      span.textContent = ` \u2192 ${formatWithPremium(amount, currency, pct)} (+${pct}%)`;
      span.style.cssText = 'color:#b8860b;font-size:0.85em;font-weight:normal;white-space:nowrap;';
      b.appendChild(span);
      injected++;
    });

    console.log('[BiddrFees] injected', injected, 'annotations at', pct + '%');
  }

  // ── MAIN ───────────────────────────────────────────────────────────────────

  async function run() {
    const cached = await getCached();

    const activate = (pct) => {
      injectPrices(pct);
      if (isLivePage) {
        // Watch .next-bid-converted for price changes — it updates atomically
        // without re-rendering, so it's a clean signal that the price changed.
        // Re-inject everything when it changes. For going-once/twice, the
        // conversion text doesn't change so this observer stays silent.
        function conversionText() {
          const b = document.querySelector('.next-bid-converted b');
          if (!b) return null;
          // Read only non-injected text
          return [...b.childNodes]
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim())
            .join('');
        }

        // Watch .next-bid-converted for actual price changes.
        // Attach lazily in the poll in case it hasn't rendered yet at activate() time.
        let lastConversion = conversionText();
        let convObs = null;
        function attachConvObs() {
          const convEl = document.querySelector('.next-bid-converted');
          if (!convEl || convObs) return;
          convObs = new MutationObserver(() => {
            const cur = conversionText();
            if (cur !== lastConversion) {
              lastConversion = cur;
              injectPrices(pct);
            }
          });
          convObs.observe(convEl, { childList: true, subtree: true, characterData: true });
        }

        // Observe popover appearances and annotate .converted-amount inside them
        // Annotate .converted-amount inside popovers.
        // Use setTimeout to wait for popover children to fully render before querying.
        function annotatePopovers() {
          document.querySelectorAll('.popover .converted-amount').forEach(el => {
            if (el.querySelector('.' + INJECTED + '_popover')) return;
            const norm = normVal(el.textContent.trim());
            const match = norm.match(valueRe);
            if (!match) return;
            const amount = parseFloat(match[1]);
            const currency = match[2];
            if (isNaN(amount) || amount <= 0) return;
            const span = document.createElement('span');
            span.className = INJECTED + '_popover';
            span.title = `${amount.toLocaleString()} ${currency} + ${pct}% buyer's premium`;
            span.textContent = `\u2192 ${formatWithPremium(amount, currency, pct)} (+${pct}%)`;
            span.style.cssText = 'color:#b8860b;font-size:0.85em;font-weight:normal;white-space:nowrap;display:block;margin-top:4px;';
            el.parentNode.appendChild(span);
          });
        }
        const popoverObs = new MutationObserver(() => setTimeout(annotatePopovers, 50));
        popoverObs.observe(document.body, { childList: true, subtree: true });

        // Poll for thumbnails and current-bid annotations; attach convObs when ready
        setInterval(() => {
          attachConvObs();
          const needsInject =
            [...document.querySelectorAll('.hammer-price .sold, .next-bid-converted b')]
              .some(el => !el.querySelector('.' + INJECTED))
            || [...document.querySelectorAll('.current-bid')]
              .some(el => !el.nextSibling?.classList?.contains(INJECTED));
          if (needsInject) injectPrices(pct);
        }, 500);
      }
    };

    if (cached !== null) {
      // Already set — inject immediately, and show a subtle "edit" button
      activate(cached);
      showEditButton(cached, async (newPct) => {
        await setCache(newPct);
        activate(newPct);
      });
    } else {
      // First visit — show prompt
      showPrompt(null, async (pct) => {
        await setCache(pct);
        activate(pct);
      });
    }
  }

  function showEditButton(currentPct, onSave) {
    if (document.getElementById('__biddr_edit__')) return;
    const btn = document.createElement('button');
    btn.id = '__biddr_edit__';
    btn.title = `Buyer's premium: ${currentPct}% — click to change`;
    btn.textContent = `BP: ${currentPct}%`;
    btn.style.cssText = `
      position: fixed; bottom: 12px; right: 12px; z-index: 999999;
      background: #1a1a2e; color: #b8860b; border: 1px solid #b8860b;
      border-radius: 4px; padding: 4px 10px; font-size: 12px;
      cursor: pointer; font-family: sans-serif;
    `;
    btn.addEventListener('click', () => {
      btn.remove();
      showPrompt(currentPct, onSave);
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 600));
  } else {
    setTimeout(run, 600);
  }

})();
