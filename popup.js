// popup.js

document.addEventListener('DOMContentLoaded', () => {
  refreshCacheCount();

  // ── TEST PARSER ──
  document.getElementById('testBtn').addEventListener('click', () => {
    const text = document.getElementById('testInput').value;
    const result = document.getElementById('testResult');
    const parsed = window.NumisParser.parseProvenance(text);
    if (parsed) {
      result.style.display = 'block';
      result.className = 'result';
      result.innerHTML = `
        <b>House:</b> ${parsed.house}<br>
        <b>Sale #:</b> ${parsed.saleNumber ?? '(date-based)'}<br>
        ${parsed.year ? `<b>Year:</b> ${parsed.year}<br>` : ''}
        <b>Lot:</b> ${parsed.lotNumber}
      `;
    } else {
      result.style.display = 'block';
      result.className = 'result error';
      result.textContent = 'Could not parse — try a different format.';
    }
  });

  // ── MANUAL CACHE ENTRY ──
  document.getElementById('cacheBtn').addEventListener('click', () => {
    const house   = document.getElementById('cacheHouse').value.trim();
    const saleNum = document.getElementById('cacheSale').value.trim();
    const nbId    = parseInt(document.getElementById('cacheNbId').value.trim(), 10);
    const result  = document.getElementById('cacheResult');

    if (!house || !saleNum || isNaN(nbId)) {
      result.style.display = 'block';
      result.className = 'result error';
      result.textContent = 'Please fill in all three fields.';
      return;
    }

    const key = `nb_sale::${house.toLowerCase()}::${saleNum}`;
    chrome.storage.local.set({ [key]: nbId }, () => {
      result.style.display = 'block';
      result.className = 'result';
      result.textContent = `Saved: ${key} → ${nbId}`;
      refreshCacheCount();
    });
  });

  // ── CACHE COUNT ──
  function refreshCacheCount() {
    chrome.storage.local.get(null, (items) => {
      const count = Object.keys(items).filter(k => k.startsWith('nb_sale::')).length;
      document.getElementById('cacheCount').textContent = count;
    });
  }

  // ── CONFIRMED BUYER'S PREMIUMS ──
  // Shows house-level premiums confirmed by the user via the inline confirm UI.
  // These are stored as nb_premium_override::{house} and can be removed here.

  const OVERRIDE_PREFIX = 'nb_premium_override::';

  function renderConfirmedList() {
    chrome.runtime.sendMessage({ type: 'GET_CONFIRMED_PREMIUMS' }, confirmed => {
      const list = document.getElementById('feeList');
      list.innerHTML = '';
      const houses = Object.keys(confirmed || {}).sort((a, b) => a.localeCompare(b));
      if (!houses.length) {
        list.innerHTML = '<div style="padding:6px 8px;font-size:11px;color:#999;font-style:italic;">No confirmed premiums yet. Use the ✓ House button on any lot page to confirm.</div>';
        return;
      }
      for (const house of houses) {
        const pct = confirmed[house];
        const row = document.createElement('div');
        row.className = 'fee-row override';
        row.innerHTML = `
          <span class="fee-name">${house}</span>
          <input class="fee-pct" type="number" min="0" max="50" step="0.5" value="${pct}" data-house="${house}" title="Edit confirmed rate" />
          <span style="font-size:11px;color:#888;">%</span>
          <button class="fee-del" data-house="${house}" title="Remove confirmation">×</button>
        `;
        list.appendChild(row);
      }
      list.querySelectorAll('.fee-pct').forEach(input => {
        input.addEventListener('change', () => {
          const pct = parseFloat(input.value);
          if (isNaN(pct) || pct < 0 || pct > 50) return;
          chrome.storage.local.set({ [OVERRIDE_PREFIX + input.dataset.house]: pct }, renderConfirmedList);
        });
      });
      list.querySelectorAll('.fee-del').forEach(btn => {
        btn.addEventListener('click', () => {
          chrome.storage.local.remove(OVERRIDE_PREFIX + btn.dataset.house, renderConfirmedList);
        });
      });
    });
  }

  renderConfirmedList();

  // ── CLEAR CACHE ──
  document.getElementById('clearCache').addEventListener('click', (e) => {
    e.preventDefault();
    if (!confirm('Clear all cached NumisBids sale IDs?')) return;
    chrome.storage.local.get(null, (items) => {
      const saleKeys = Object.keys(items).filter(k => k.startsWith('nb_sale::'));
      chrome.storage.local.remove(saleKeys, () => refreshCacheCount());
    });
  });
});
