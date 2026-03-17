#!/usr/bin/env node
// build_lookup.js
//
// Pre-populates the extension's sale ID cache by performing the same
// Google searches the extension uses at runtime, but in batch.
//
// Usage:
//   node build_lookup.js                    # batch process KNOWN_SALES list
//   node build_lookup.js --add "CNG 100"    # resolve a single citation
//
// Output: nb_sale_cache.json  — import into the extension via Service Worker console

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── KNOWN SALES TO PRE-WARM ────────────────────────────────────────────────
// Add the sales you care about. The extension auto-caches as you use it,
// but this is useful for pre-loading known citations in bulk.

const KNOWN_SALES = [
  { house: 'Gorny & Mosch', saleNumber: 257, year: 2018 },
  { house: 'Gorny & Mosch', saleNumber: 244, year: 2017 },
  { house: 'CNG',           saleNumber: 100, year: 2015 },
  { house: 'CNG',           saleNumber: 501 },
  { house: 'NAC',           saleNumber:  84, year: 2015 },
  { house: 'Nomos',         saleNumber:  15, year: 2017 },
  // Add more as needed...
];

// ── HTTP ──────────────────────────────────────────────────────────────────────

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, (res) => {
      if ([301, 302].includes(res.statusCode)) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── GOOGLE LOOKUP ─────────────────────────────────────────────────────────────

function buildQuery(house, saleNumber, year) {
  const h = house.replace(/[&'.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [`site:numisbids.com`, `"${h}"`, `"${saleNumber}"`];
  if (year) parts.push(`"${year}"`);
  return parts.join(' ');
}

function extractSaleId(html) {
  const pats = [
    /href="\/url\?q=https?:\/\/(?:www\.)?numisbids\.com\/sale\/(\d+)/gi,
    /href="https?:\/\/(?:www\.)?numisbids\.com\/sale\/(\d+)/gi,
    /numisbids\.com%2Fsale%2F(\d+)/gi,
    /numisbids\.com\/sale\/(\d+)/gi,
  ];
  for (const p of pats) {
    p.lastIndex = 0;
    const m = p.exec(html);
    if (m && parseInt(m[1]) > 0) return parseInt(m[1]);
  }
  return null;
}

async function resolveSale(house, saleNumber, year) {
  const q = buildQuery(house, saleNumber, year);
  const html = await fetchText(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
  return extractSaleId(html);
}

const cacheKey = (house, saleNumber) => `nb_sale::${house.toLowerCase()}::${saleNumber}`;

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--add')) {
    const citation = args[args.indexOf('--add') + 1] || '';
    const m = citation.match(/^(.*?)\s+(\d+)(?:\s*,?\s*(\d{4}))?$/);
    if (!m) { console.error('Could not parse. Try: --add "Gorny & Mosch 257 2018"'); process.exit(1); }
    const [, house, saleNum, year] = m;
    console.log(`Searching: ${house} ${saleNum}${year ? ` (${year})` : ''}...`);
    const id = await resolveSale(house, parseInt(saleNum), year ? parseInt(year) : null);
    if (id) {
      console.log(`✓ Sale ID: ${id}  →  https://www.numisbids.com/sale/${id}`);
      console.log(`  Cache key: ${cacheKey(house, saleNum)}`);
    } else {
      console.log('✗ Not found');
    }
    return;
  }

  const cache = {};
  let found = 0, missed = 0;

  for (const { house, saleNumber, year } of KNOWN_SALES) {
    process.stdout.write(`  ${house} ${saleNumber}${year ? ` (${year})` : ''}... `);
    try {
      const id = await resolveSale(house, saleNumber, year);
      if (id) {
        cache[cacheKey(house, saleNumber)] = id;
        console.log(`${id}`);
        found++;
      } else {
        console.log('not found');
        missed++;
      }
    } catch (e) {
      console.log(`error: ${e.message}`);
      missed++;
    }
    await sleep(2000 + Math.random() * 1000);
  }

  const out = path.join(__dirname, 'nb_sale_cache.json');
  fs.writeFileSync(out, JSON.stringify(cache, null, 2));
  console.log(`\n${found} found, ${missed} missed → ${out}`);
  console.log('\nImport via Service Worker DevTools console:');
  console.log(`const d = ${JSON.stringify(cache)};`);
  console.log('chrome.storage.local.set(d, () => console.log("done"));');
}

main().catch(console.error);
