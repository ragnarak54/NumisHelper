// numisbids_fees.js
// Runs on NumisBids lot pages and the watchlist page.
// Fetches the buyer's premium for each sale and injects with-premium prices.

(function () {
  'use strict';

  const isLotPage = /\/sale\/\d+\/lot\/\d+/.test(location.pathname);
  const isWatchlist = location.pathname === '/watchlist' || location.pathname.startsWith('/watchlist');

  if (!isLotPage && !isWatchlist) return;

  // Single sale ID for lot pages; null for watchlist (resolved per-card)
  const saleId = isLotPage ? (location.pathname.match(/\/sale\/(\d+)/)?.[1] ?? null) : null;

  // ── PREMIUM CACHE ──────────────────────────────────────────────────────────
  // Cache per sale ID so we only fetch terms once per sale

  function cacheKey(sid) { return `nb_premium::${sid}`; }

  async function getCachedPremium(sid) {
    const k = cacheKey(sid);
    return new Promise(r => chrome.storage.local.get([k], d => r(d[k] ?? null)));
  }

  async function cachePremium(sid, pct) {
    return new Promise(r => chrome.storage.local.set({ [cacheKey(sid)]: pct }, r));
  }

  // ── SHARED UTILITIES ──────────────────────────────────────────────────────
  // Defined once at module scope; used by both injectPrices and injectWatchlistPrices.

  const labelRe = /^(Estimate|Starting price|Opening bid|Current bid|Minimum bid|Reserve|Price realized):?\s*$/i;
  const inlineLabelRe = /^(?:Estimate|Starting price|Opening bid|Current bid|Minimum bid|Reserve|Price realized):\s*(\d+)\s+([A-Z]{3})\s*$/i;
  const valueRe = /^(\d+)\s+([A-Z]{3})\s*$/;
  function normVal(s) { return s.replace(/(\d)[^\dA-Z](\d)/g, '$1$2').trim(); }
  function formatWithPremium(amount, currency, premiumPct) {
    return `${Math.round(amount * (1 + premiumPct / 100))} ${currency}`;
  }



  // ── TERMS FETCH + PARSE ────────────────────────────────────────────────────

  // Returns { pct, confidence } where confidence is 'confirmed' | 'tentative' | 'unknown'
  async function fetchPremium(sid) {
    // 1. Sale-level confirmation — always wins
    const confirmedKey = `nb_confirmed_sale::${sid}`;
    const saleConfirmed = await new Promise(r => chrome.storage.local.get([confirmedKey], d => r(d[confirmedKey] ?? null)));
    if (saleConfirmed !== null) {
      // house is stored alongside pct when the sale was confirmed.
      // For older records that predate house storage, fall through to get it from background.
      let houseName = saleConfirmed.house || null;
      if (!houseName) {
        const knownResp = await new Promise(r =>
          chrome.runtime.sendMessage({ type: 'GET_KNOWN_PREMIUM', saleId: sid }, r)
        );
        houseName = knownResp?._firmName || null;
      }
      return { pct: saleConfirmed.pct, confidence: 'confirmed', houseName };
    }

    // 2. House-level override / known premium (always checked before cache,
    //    so a stale terms-fetched cache value never masks the known table)
    const override = await new Promise(r =>
      chrome.runtime.sendMessage({ type: 'GET_KNOWN_PREMIUM', saleId: sid }, r)
    );
    if (override?.isOverride) {
      await cachePremium(sid, override.premium ?? 0);
      return { pct: override.premium, confidence: 'confirmed', houseName: override._firmName || null };
    }
    if (override?.premium !== undefined) {
      // Known table hit — use it directly, no need to check stale cache
      return { pct: override.premium, confidence: 'tentative', houseName: override._firmName || null };
    }

    // 3. Per-sale cache (terms-fetched value for houses not in known table)
    const cached = await getCachedPremium(sid);
    if (cached !== null) return { pct: cached, confidence: 'tentative', houseName: override?._firmName || null };

    // 5. Fetch terms page
    const termsUrl = `/sales/hosted/saleterms.php?sid=${sid}`;
    try {
      const resp = await fetch(termsUrl);
      if (!resp.ok) return { pct: null, confidence: 'unknown' };
      const html = await resp.text();
      const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const idx = plainText.search(/commission|premium|aufgeld/i);
      if (idx >= 0) console.log('[NumisFees] terms snippet:', plainText.slice(Math.max(0, idx-20), idx+120));
      let pct = extractPremiumFromTerms(html);
      if (pct !== null) await cachePremium(sid, pct);
      return { pct, confidence: pct !== null ? 'tentative' : 'unknown', houseName: override?._firmName || null };
    } catch (e) {
      console.warn('[NumisFees] Could not fetch terms:', e.message);
      return { pct: null, confidence: 'unknown', houseName: override?._firmName || null };
    }
  }

  function extractPremiumFromTerms(html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Prioritised patterns — try most-specific first, collect ALL matches,
    // then return the largest value found (the actual buyer's premium is
    // almost always the largest commission figure; incidental mentions like
    // "10% discount on printed catalogs" will be smaller).
    const patterns = [
      // "levied on the hammer" / "on the hammer price" — most specific
      /([\d]+(?:[.,]\d+)?)\s*%[^.]{0,60}(?:levied|charged|payable)\s+on\s+the\s+hammer/gi,
      // "buyer's premium/commission of X%"
      /buyer[\u2019's]*\s*(?:premium|commission|fee)\s+(?:of\s+|will be added\s+)?([\d]+(?:[.,]\d+)?)\s*%/gi,
      // "X% buyer's premium/commission"
      /([\d]+(?:[.,]\d+)?)\s*%\s+buyer[\u2019's]*\s*(?:premium|commission|fee)/gi,
      // German: "Aufgeld von X%" / "X% Aufgeld"
      /aufgeld\s+(?:von\s+)?([\d]+(?:[.,]\d+)?)\s*%/gi,
      /([\d]+(?:[.,]\d+)?)\s*%\s+aufgeld/gi,
      // French/Italian: "commission de X%" / "diritto d'asta X%"
      /(?:commission\s+de|diritto\s+d['\u2019]asta)\s+([\d]+(?:[.,]\d+)?)\s*%/gi,
      // "X% over the sale/hammer price" (Spanish/international style)
      /([\d]+(?:[.,]\d+)?)\s*%\s+over\s+the\s+(?:sale|hammer)\s+price/gi,
      // "liable to pay X%"
      /liable\s+to\s+pay\s+([\d]+(?:[.,]\d+)?)\s*%/gi,
      // "with a premium of X%" / "a premium of X%" (simple non-tiered)
      /\bwith\s+a\s+premium\s+of\s+([\d]+(?:[.,]\d+)?)\s*%/gi,
      /\ba\s+premium\s+of\s+([\d]+(?:[.,]\d+)?)\s*%/gi,
      // Generic fallback — last resort
      /\b(?:commission|fee)\s+of\s+([\d]+(?:[.,]\d+)?)\s*%/gi,
      /([\d]+(?:[.,]\d+)?)\s*%[^.]{0,40}will be added/gi,
    ];

    const found = [];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(text)) !== null) {
        const pct = parseFloat(m[1].replace(',', '.'));
        if (pct > 0 && pct < 50) found.push(pct);
      }
      if (found.length) break; // stop at first pattern that matches anything
    }

    if (!found.length) {
      // Multi-tier format: "payable in addition to the hammer price" followed
      // by lettered clauses each containing "a premium of X%".
      // e.g. Künker, Gorny: 25% EU VAT-incl / 20% EU + VAT / 22% non-EU / 2.5% online
      // Strategy: collect all "premium of X%" values, discard the small online
      // surcharge (≤5%), discard VAT-inclusive figures (marked "VAT included" nearby),
      // then prefer the "outside the EU" rate, else take the median of what's left.
      if (/payable in addition to the hammer price|in addition to the hammer/i.test(text)) {
        // Capture up to 120 chars before and 80 after to catch 'outside the EU' context
        const tierRe = /([^.]{0,120})a premium of ([\d]+(?:[.,]\d+)?)\s*%([^.]{0,80})/gi;
        const tiers = [];
        let tm;
        while ((tm = tierRe.exec(text)) !== null) {
          const pct = parseFloat(tm[2].replace(',', '.'));
          const ctx = (tm[1] + tm[3]).toLowerCase();
          if (pct <= 0 || pct >= 50) continue;
          tiers.push({ pct, vatIncluded: /vat included|incl.*vat/i.test(ctx), online: /online/i.test(ctx), outsideEU: /outside.*eu|non.eu|non-eu/i.test(ctx) });
        }
        // Prefer explicit non-EU rate (cleanest base rate, no VAT bundled)
        const nonEU = tiers.find(t => t.outsideEU && !t.online);
        if (nonEU) return nonEU.pct;
        // Otherwise take the lowest non-online, non-VAT-inclusive tier
        const base = tiers.filter(t => !t.online && !t.vatIncluded && t.pct > 5);
        if (base.length) return Math.min(...base.map(t => t.pct));
        // Last resort: lowest non-online tier above 5%
        const any = tiers.filter(t => !t.online && t.pct > 5);
        if (any.length) return Math.min(...any.map(t => t.pct));
      }
      return null;
    }
    // Return the largest match — the actual buyer's premium is nearly always
    // the biggest commission figure in the document
    return Math.max(...found);
  }


  // ── CURRENCY POPUP AUGMENTATION ──────────────────────────────────────────
  // NumisBids shows a dynamic popup on hover over prices with approximate
  // values in EUR/USD/GBP. We observe the DOM for this popup appearing and
  // add a with-premium column to each currency row.

  function augmentCurrencyPopup(table, premiumPct) {
    if (table.dataset.premiumDone) return;
    table.dataset.premiumDone = '1';

    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;

      const currency = cells[0].textContent.replace(/\W/g, '').trim(); // strip &nbsp; etc
      if (!/^[A-Z]{3}$/.test(currency)) return;

      const amount = parseFloat(cells[1].textContent.replace(/\s/g, '').replace(',', '.'));
      if (isNaN(amount) || amount <= 0) return;

      if (row.querySelector('.__numis_premium_cell__')) return;

      const withPremium = formatWithPremium(amount, currency, premiumPct);
      const td = document.createElement('td');
      td.className = '__numis_premium_cell__';
      td.style.cssText = 'color:#7a5c00;font-style:italic;padding-left:8px;white-space:nowrap;';
      td.textContent = `\u2192 ${withPremium}`;
      row.appendChild(td);
    });
  }

  function observeCurrencyPopup(premiumPct) {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Target ratetable directly — either the node itself or a descendant
          const tables = node.classList?.contains('ratetable')
            ? [node]
            : [...node.querySelectorAll('table.ratetable')];
          for (const table of tables) {
            augmentCurrencyPopup(table, premiumPct);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── INIT ──────────────────────────────────────────────────────────────────

  async function init() {
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    if (isLotPage) {
      // fetchPremium returns {pct, confidence, houseName} — all from one background call
      const { pct: premiumPct, confidence, houseName } = await fetchPremium(saleId);
      if (premiumPct === null) {
        // Unknown premium — still inject the UI so user can enter it manually
        console.warn('[NumisFees] Could not determine buyer\'s premium for sale', saleId, '— showing manual entry UI');
        injectPrices(0, 'unknown', saleId, houseName);
        return;
      }
      injectPrices(premiumPct, confidence, saleId, houseName);
      observeCurrencyPopup(premiumPct);
    } else if (isWatchlist) {
      await injectWatchlistPrices();
    }
  }

  async function injectWatchlistPrices() {
    // premiumMap persists across initial load and mutation observer callbacks
    const premiumMap = {};

    function findSaleIdForNode(node) {
      let el = node.parentElement;
      while (el && el !== document.body) {
        const link = el.querySelector('a[href*="/sale/"][href*="/lot/"]');
        if (link) {
          const m = link.href.match(/\/sale\/(\d+)\/lot\//);
          if (m) return m[1];
        }
        el = el.parentElement;
      }
      return null;
    }

    function extractFirmNameForSale(sid) {
      // Find a lot link for this sale, then walk up to the sale section heading
      // which typically contains the firm name + sale title
      const lotLink = document.querySelector(`a[href*="/sale/${sid}/lot/"]`);
      if (!lotLink) return null;
      // Walk up looking for a heading element that contains the firm name
      let el = lotLink.parentElement;
      while (el && el !== document.body) {
        // Sale group headers on watchlist are typically <b> or heading tags
        const heading = el.previousElementSibling || el.parentElement?.previousElementSibling;
        if (heading) {
          const text = heading.textContent.trim();
          // Heading looks like "Künker Auction 438 (16-17 Mar 2026)"
          // Extract everything before the sale number
          const m = text.match(/^([^0-9(]+?)(?:\s+(?:Auction|Sale|E-Auction|eLive)\s+\d|\s+\d{3,}|\s*\()/i);
          if (m) {
            // Strip leading non-alpha chars (e.g. '▼ ', '► ') and trailing qualifiers
            return m[1].trim()
              .replace(/^[^\p{L}]+/u, '')  // strip leading non-letter chars like ▼
              .replace(/\s+(?:Electronic|E-Auction|eLive|Online|Live|Auction|Sale)\s*$/i, '')
              .trim();
          }
        }
        el = el.parentElement;
      }
      return null;
    }

    async function ensurePremium(sid) {
      // 1. Sale-level confirmation — highest priority, always wins
      const confirmedKey = `nb_confirmed_sale::${sid}`;
      const saleConfirmed = await new Promise(r =>
        chrome.storage.local.get([confirmedKey], d => r(d[confirmedKey] ?? null))
      );
      if (saleConfirmed !== null) {
        const result = { pct: saleConfirmed.pct, confidence: 'confirmed' };
        premiumMap[sid] = result;
        return result;
      }

      // 2. House-level override — also confirmed
      const firmName = extractFirmNameForSale(sid);
      const known = await new Promise(r =>
        chrome.runtime.sendMessage({ type: 'GET_KNOWN_PREMIUM', saleId: sid, firmNameHint: firmName || undefined }, r)
      );
      if (known?.isOverride) {
        const result = { pct: known.premium, confidence: 'confirmed' };
        premiumMap[sid] = result;
        return result;
      }

      // In-memory cache for tentative values — only after both confirmed checks pass
      if (sid in premiumMap && premiumMap[sid].confidence !== 'confirmed') return premiumMap[sid];

      // 3. Known table
      if (known?.premium !== undefined) {
        const result = { pct: known.premium, confidence: 'tentative' };
        premiumMap[sid] = result;
        return result;
      }

      // 4. Terms fetch — skipped on watchlist to avoid excessive requests.
      // The watchlist shows many sales simultaneously; fetching terms for each
      // unknown house would hammer NumisBids. User can confirm via lot page instead.
      premiumMap[sid] = { pct: null, confidence: 'unknown' };
      return premiumMap[sid];
    }

    async function processContainer(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const candidates = [];
      let node;
      while ((node = walker.nextNode())) {
        if (labelRe.test(node.textContent.trim())) candidates.push(node);
      }
      for (const labelNode of candidates) {
        // Check if value is inline with label ("Current bid: None" or "Minimum bid: 400 EUR")
        const labelText = labelNode.textContent.trim();
        const inlineM = normVal(labelText).match(inlineLabelRe);

        let amount, currency, insertAfterNode;
        if (inlineM) {
          // Value and label in same node — skip "None", inject after the text node itself
          amount = parseFloat(inlineM[1].replace(/[,'\u00a0\s]/g, ''));
          currency = inlineM[2];
          insertAfterNode = labelNode;
        } else {
          const valueNode = nextMeaningfulTextNode(labelNode);
          if (!valueNode) continue;
          const vm = normVal(valueNode.textContent.trim()).match(valueRe);
          if (!vm) continue;
          amount = parseFloat(vm[1].replace(/[,'\u00a0\s]/g, ''));
          currency = vm[2];
          insertAfterNode = valueNode;
        }

        if (isNaN(amount) || amount <= 0) continue;
        const afterInsert = insertAfterNode.nextSibling;
        if (afterInsert && afterInsert.className === '__numis_premium__') continue;
        const sid = findSaleIdForNode(labelNode);
        if (!sid) continue;
        const { pct: premiumPct, confidence } = await ensurePremium(sid);
        if (premiumPct === null || premiumPct === undefined) continue;
        const withPremium = formatWithPremium(amount, currency, premiumPct);
        const span = document.createElement('span');
        span.className = '__numis_premium__';
        const isTentative = confidence !== 'confirmed';
        span.title = `${isTentative ? 'Tentative: ' : ''}${premiumPct}% buyer's premium`;
        span.textContent = ` \u2192 ${withPremium} (+${premiumPct}%${isTentative ? '?' : ''})`;
        if (isTentative) span.style.cssText = 'color:#a08840;font-style:italic;opacity:0.85;';
        const parent = insertAfterNode.parentNode;
        if (afterInsert) parent.insertBefore(span, afterInsert);
        else parent.appendChild(span);
      }
    }


    // Process all cards — run immediately and again after delays to catch
    // cards that render progressively or are in collapsed sections
    await processContainer(document.body);
    setTimeout(() => processContainer(document.body), 500);
    setTimeout(() => processContainer(document.body), 2000);

    // Re-run whenever a sale section is expanded (the ▼ toggle headers)
    document.body.addEventListener('click', () => {
      setTimeout(() => processContainer(document.body), 100);
    });
  }

  init();

})();
