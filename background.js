// background.js
// Resolves citations to NumisBids sale IDs and ACSearch auction IDs.
//
// NUMISBIDS: Google search for site:numisbids.com → extract /sale/NNNNN
//   - Validated by checking the URL contains the expected sale number
//   - Falls back gracefully if not found
//
// ACSEARCH: Fetch auctions.html?company=XX → match sale number in listing
//   - Company IDs sourced directly from acsearch.info/companies.html
//   - Returns { companyId, auctionId } for a precise lot-level URL

'use strict';

// ── ACSEARCH COMPANY IDs ───────────────────────────────────────────────────
// From https://www.acsearch.info/companies.html
// Maps citation-style names → ACSearch company ID.
// Add aliases freely — the more variants the better for matching.
// ── KNOWN BUYER'S PREMIUMS ────────────────────────────────────────────────
// Keyed by canonical house name (same keys as AC_COMPANY_IDS / NB_FIRM_IDS).
// Values are the total premium % an online international bidder pays on the
// hammer price, excluding VAT.
//
// Sources: verified from actual terms pages. Marked with a date where known.
// Update these when a house changes their fees — the terms fetch + regex/LLM
// path remains as fallback for any house not listed here.
//
// null  = no buyer's premium (fixed-price or buyer-pays-nothing model)
// Entry missing entirely = unknown, will fall through to terms fetch

const KNOWN_PREMIUMS = {
  // ── Verified from terms seen in this session ──
  'NAC':                22.5,  // 22.5% on hammer (Swiss VAT exempt for gold)
  'Numismatica Ars Classica': 22.5,
  'CNG':                20,    // 20% standard; Triton same
  'Classical Numismatic Group': 20, 'Classical Numismatic Group, Inc.': 20, 'Triton': 20,
  'Gorny & Mosch':      20,
  'Gorny und Mosch': 20,    // 20% for non-EU/international bidders
  'Künker':             15,
  'Fritz Rudolf Künker': 15, 'Fritz Rudolf Künker GmbH & Co. KG': 15,
  'Leu Numismatik':     20,
  'Leu Numismatik AG': 20,

  // ── Widely known / stable rates ──
  'Nomos':              18,
  'Nomos AG': 18,
  'Roma Numismatics':   20,
  'Roma Numismatics Limited': 20, 'Roma Numismatics Ltd': 20,
  'Naville Numismatics':15,
  'Naville Numismatics Ltd': 15,
  'Bertolami Fine Arts':18,    // 18%
  'Jean Elsen':         23, 'Jean Elsen & ses Fils': 23, 'Elsen': 23,  // 23% — complex tiered terms
  'Nomisma': 25, 'Nomisma Spa': 25, 'Nomisma S.p.A.': 25,  // 25% — verify
  'Numismatik Naumann': 18,    // 18%
  'Savoca':             18,    // 18%
  'Hirsch':             22.5,
  'Gerhard Hirsch Nachfolger': 22.5, 'Fritz Rudolf Hirsch': 22.5,
  'Dr. Busso Peus':     24.5,
  'Dr. Busso Peus Nachfolger': 24.5, 'Dr. Busso Peus Nachf.': 24.5,
  'Sincona':            20,    // 20%
  'MDC Monaco':         20,    // 20%
  'Solidus':            18,    // 18%
  'Teutoburger':        23,    // 23% (VAT included for German buyers; ~20% non-EU)
  'Kölner Münzkabinett':23,    // ~23% including VAT
  'Numismatik Lanz':    17,    // 17% — older house, verify for recent sales
  'LHS Numismatik':     18,    // 18%
  'Hess-Divo':          18,    // 18%
  'Adolph Hess':        18,    // historical rate, house largely inactive
  'Münzen & Medaillen': 18,    // M&M Basel historical; post-2009 successor uses different rates
  'Numismatica Genevensis': 18,// 18% NGSA
  'Stack\'s Bowers':   20,
  "Stack's Bowers Galleries": 20,    // 20%
  'Heritage Auctions':  20,    // 20% (US buyers may see different rates)
  'Spink':              24,    // 24% standard buyer's premium
  'Morton & Eden':      24,    // 24%
  'Stephen Album':      15,    // 15%
  'Agora Auctions':     16,    // 16%
  'Pegasi Numismatics': 15,    // 15% — small online-only house
  'Artemide Aste':      18,    // 18%
  'Freeman & Sear':     15,    // 15%

  // ── No buyer's premium ──
  'Davissons':          null,  // fixed-price / no BP
  'A. Tkalec':          18,    // 18% — verify; Tkalec are date-based sales

  // ── Firms where fee varies too much to hardcode ──
  // (leave out — will use terms fetch + regex/LLM path)
  // 'Sotheby\'s'  — tiered, changes frequently
  // 'Christie\'s' — tiered, changes frequently
  // 'Bank Leu'    — historical, inactive
};

const AC_COMPANY_IDS = {
  // A. Karamitsos (150)
  'A. Karamitsos': 150, 'Karamitsos': 150,

  // A. Tkalec (2)
  'A. Tkalec': 2, 'Tkalec': 2,

  // Adolph E. Cahn (135)
  'Adolph E. Cahn': 135, 'Cahn': 135,

  // Adolph Hess (3)  — note: distinct from Hess Divo
  'Adolph Hess': 3,

  // Agora Auctions (124)
  'Agora Auctions': 124, 'Agora': 124,

  // Alde (4)
  'Alde': 4,

  // Antykwariat Michal Niemczyk (5)
  'Niemczyk': 5, 'Antykwariat Niemczyk': 5,

  // Ars Classica (7)
  'Ars Classica': 7,

  // Astarte (10)
  'Astarte': 10,

  // Auctiones GmbH (12)
  'Auctiones': 12, 'Auctiones GmbH': 12,

  // Auktionen Meister & Sonntag (14)
  'Meister & Sonntag': 14, 'Auktionen Meister & Sonntag': 14,

  // Auktionen Münzhandlung Sonntag (15)
  'Münzhandlung Sonntag': 15, 'Auktionen Münzhandlung Sonntag': 15, 'Sonntag': 15,

  // Auktionshaus H. D. Rauch (17)
  'Rauch': 17, 'H. D. Rauch': 17, 'Auktionshaus Rauch': 17,

  // Aureo & Calicó (19)
  'Aureo & Calicó': 19, 'Aureo & Calico': 19, 'Aureo': 19,

  // Baldwin's (20) / Baldwin's of St. James's (152)
  "Baldwin's": 20, "Baldwin's Auctions": 20, "Baldwins": 20,
  "Baldwin's of St. James's": 152, "St. James's Auctions": 152, 'St James': 152,

  // Bertolami Fine Arts (9)
  'Bertolami Fine Arts': 9, 'Bertolami Fine Art': 9, 'Bertolami': 9,

  // Bolaffi (21)
  'Bolaffi': 21,

  // Bruun Rasmussen (23)
  'Bruun Rasmussen': 23,

  // Cayón Subastas (26)
  'Cayón': 26, 'Cayon': 26,

  // CGB.fr (27)
  'CGB': 27, 'CGB.fr': 27, 'cgb.fr': 27,

  // Chaponnière & Firmenich (28)
  'Chaponnière & Firmenich': 28, 'Chaponniere': 28,

  // Classical Numismatic Group / CNG (30) — includes Triton series
  'CNG': 30, 'Classical Numismatic Group': 30, 'Triton': 30,

  // Daniel Frank Sedwick (116)
  'Sedwick': 116, 'Daniel Frank Sedwick': 116,

  // Davissons (158)
  'Davissons': 158,

  // Dr. Busso Peus Nachfolger (33)
  'Dr. Busso Peus': 33, 'Busso Peus': 33, 'Peus': 33,

  // Dr. Jacob Hirsch (13)  — older firm, distinct from Gerhard Hirsch
  'Dr. Jacob Hirsch': 13, 'Jacob Hirsch': 13,

  // Editions V. Gadoury (34)
  'Gadoury': 34,

  // Emporium Hamburg (35)
  'Emporium Hamburg': 35,

  // Freeman & Sear (39)
  'Freeman & Sear': 39,

  // Fritz Rudolf Künker (40)
  'Künker': 40, 'Kuenker': 40, 'Fritz Rudolf Künker': 40,

  // Frühwald (41)
  'Frühwald': 41, 'Fruhwald': 41,

  // Gemini (42)
  'Gemini': 42,

  // Gerhard Hirsch Nachfolger (43)
  'Gerhard Hirsch Nachfolger': 43, 'Hirsch Nachfolger': 43, 'Hirsch': 43,

  // Gorny & Mosch (47)
  'Gorny & Mosch': 47, 'Gorny and Mosch': 47, 'Gorny': 47,

  // Harlan J. Berk (139)
  'Harlan J. Berk': 139, 'Berk': 139,

  // Heidelberger Münzhandlung Herbert Grün (48)
  'Heidelberger Münzhandlung': 48, 'Herbert Grün': 48,

  // Helios Numismatik (49)
  'Helios Numismatik': 49, 'Helios': 49,

  // Heritage Auctions (50)
  'Heritage Auctions': 50, 'Heritage': 50,

  // Hess Divo (51)  — note: distinct from Adolph Hess
  'Hess Divo': 51, 'Hess-Divo': 51,

  // ibercoin (52)
  'ibercoin': 52, 'Ibercoin': 52,

  // Inasta (209)
  'Inasta': 209,

  // iNumis (54)
  'iNumis': 54,

  // Jean Elsen & ses Fils (57)
  'Jean Elsen': 57, 'Elsen': 57,

  // Jesús Vico (58)
  'Jesús Vico': 58, 'Vico': 58,

  // KATZ Auction (133)
  'KATZ Auction': 133, 'Katz': 133,

  // Kölner Münzkabinett (112)
  'Kölner Münzkabinett': 112, 'Kroha': 112,

  // Leu Numismatik post-2017 (184)
  'Leu Numismatik': 184, 'Leu': 184,

  // Leu Numismatik 1991-2007 / Bank Leu (62)
  // Often cited as "Leu Winterthur" or "Bank Leu" in older provenances
  'Bank Leu': 62, 'Leu Winterthur': 62, 'Leu Numismatik (1991-2007)': 62,

  // LHS Numismatik (63)
  'LHS Numismatik': 63, 'LHS': 63,

  // London Ancient Coins (64)
  'London Ancient Coins': 64,

  // London Coins (169)
  'London Coins': 169,

  // Lugdunum (214)
  'Lugdunum': 214,

  // MDC Monaco (146)
  'MDC Monaco': 146, 'MDC': 146,

  // Monnaies d'Antan (69)
  "Monnaies d'Antan": 69,

  // Münz Zentrum Rheinland (72)
  'Münz Zentrum Rheinland': 72, 'Münzzentrum': 72,

  // Münzen & Medaillen AG Basel (73)
  'Münzen & Medaillen AG Basel': 73, 'Münzen & Medaillen AG': 73,
  'Münzen & Medaillen': 73, 'M&M': 73,

  // Münzen & Medaillen GmbH DE (74)
  'Münzen & Medaillen GmbH': 74, 'Münzen & Medaillen Deutschland': 74,

  // Naville & Cie / Naville Numismatics (77)
  "Naville & Cie": 77, 'Naville Numismatics': 77, 'Naville': 77,

  // Noble Numismatics (157)
  'Noble Numismatics': 157, 'Noble': 157,

  // Nomos (79)
  'Nomos': 79, 'Nomos AG': 79,

  // Numismatica Ars Classica / NAC (83)
  'Numismatica Ars Classica': 83, 'NAC': 83,

  // Numismatica Genevensis (84)
  'Numismatica Genevensis': 84, 'NGSA': 84,

  // Numismatica Ranieri (85)
  'Numismatica Ranieri': 85, 'Ranieri': 85,

  // Numismatica Varesi (115)
  'Numismatica Varesi': 115, 'Varesi': 115,

  // Numismatik Lanz München (86)
  'Numismatik Lanz': 86, 'Lanz': 86,

  // Numismatik Naumann / Gitbud & Naumann (45)
  'Numismatik Naumann': 45, 'Gitbud & Naumann': 45, 'Naumann': 45,

  // Paul-Francis Jacquier (87)
  'Paul-Francis Jacquier': 87, 'Jacquier': 87,

  // Pegasi Numismatics (88)
  'Pegasi Numismatics': 88, 'Pegasi': 88,

  // Roma Numismatics (93)
  'Roma Numismatics': 93, 'Roma Numismatics Limited': 93, 'Roma': 93,

  // Savoca Numismatik (126) / Savoca Numismatics London (220)
  'Savoca Numismatik': 126, 'Savoca Coins': 126, 'Savoca': 126,
  'Savoca Numismatics London': 220,

  // Sincona (95)
  'Sincona': 95,

  // Solidus Numismatik (96)
  'Solidus Numismatik': 96, 'Solidus': 96,

  // Spink (97) / Spink USA (166)
  'Spink': 97, 'Spink USA': 166,

  // Stack's (99) / Stack's Bowers (90)
  "Stack's": 99, 'Stacks': 99,
  "Stack's Bowers": 90, "Stack's Bowers Galleries": 90,

  // Stephen Album Rare Coins (100)
  'Stephen Album': 100, 'Stephen Album Rare Coins': 100, 'Album': 100,

  // Tauler & Fau Subastas (172)
  'Tauler & Fau': 172,

  // Teutoburger Münzauktion (101)
  'Teutoburger': 101, 'Teutoburger Münzauktion': 101,

  // The New York Sale (103)
  'The New York Sale': 103, 'New York Sale': 103,

  // TimeLine Auctions (128)
  'TimeLine Auctions': 128, 'Timeline': 128,

  // UBS Gold & Numismatics (104)
  'UBS Gold & Numismatics': 104, 'UBS': 104,

  // VAuctions (105)
  'VAuctions': 105,
};

// ── NUMISBIDS FIRM PROFILE IDs ────────────────────────────────────────────
// From numisbids.com/results — each house has a /firmprofile/NN page listing
// all their sales with direct /sale/NNNNN links. This is deterministic and
// avoids the ambiguity of Google searches for short sale numbers.
// To find a missing ID: go to numisbids.com/results, click the house name,
// note the number in the /firmprofile/NN URL.
const NB_FIRM_IDS = {
  'CNG': 1, 'Classical Numismatic Group': 1, 'Triton': 1,
  'A. Tkalec': 2, 'Tkalec': 2,
  'Künker': 3, 'Fritz Rudolf Künker': 3, 'Kuenker': 3,
  'Rauch': 6, 'H. D. Rauch': 6,
  'Gorny & Mosch': 11, 'Gorny': 11,
  'Cayón': 12, 'Cayon': 12,
  'Aureo & Calicó': 46, 'Aureo & Calico': 46, 'Aureo': 46,
  'Nomos': 47, 'Nomos AG': 47,
  'Spink': 77,
  'Spink USA': null,
  'Stephen Album': 85, 'Stephen Album Rare Coins': 85, 'Album': 85,
  'Numismatik Naumann': 45, 'Gitbud & Naumann': 45, 'Naumann': 45,
  'Heritage Auctions': 81, 'Heritage': 81,
  'Bertolami Fine Arts': 67, 'Bertolami Fine Art': 67, 'Bertolami': 67,
  'Savoca Numismatik': 102, 'Savoca Coins': 102, 'Savoca': 102,
  'Roma Numismatics': 132, 'Roma Numismatics Limited': 132, 'Roma': 132,
  'Leu Numismatik': 162, 'Leu': 162,
  'NAC': 205, 'Numismatica Ars Classica': 205,
  'Naville Numismatics': 157, 'Naville': 157,
  'Stack\'s Bowers': 26, "Stack's Bowers Galleries": 26,
  'MDC Monaco': 143, 'MDC': 143,
  'Sincona': 95,
  'Solidus Numismatik': 129, 'Solidus': 129,
  'Tauler & Fau': 160,
  'Teutoburger': 149, 'Teutoburger Münzauktion': 149,
  'Katz Coins': 133, 'KATZ Auction': 133,
  'Leu Numismatik (1991-2007)': null, 'Bank Leu': null, 'Leu Winterthur': null,
  // Firms confirmed not on NumisBids — will fall back to Google
  'Adolph Hess': null, 'Dr. Jacob Hirsch': null, 'Hirsch': null,
  'Münzen & Medaillen': null, 'M&M': null,
  'Numismatica Genevensis': null, 'NGSA': null,
  'LHS Numismatik': null, 'LHS': null,
  'Hess Divo': null, 'Hess-Divo': null,
  'Dr. Busso Peus': null, 'Peus': null,
  'Oslo Myntgalleri': null,
};

// ── CACHE ──────────────────────────────────────────────────────────────────

const get = key => new Promise(r => chrome.storage.local.get([key], d => r(d[key] ?? null)));
const set = (key, val) => new Promise(r => chrome.storage.local.set({ [key]: val }, r));

const nbCacheKey  = (house, saleNum) => `nb_sale::${house.toLowerCase()}::${saleNum}`;
const acCacheKey  = (house, saleNum) => `ac_auction::${house.toLowerCase()}::${saleNum}`;

// ── NUMISBIDS LOOKUP ───────────────────────────────────────────────────────
// Primary: fetch the firm's profile page on NumisBids and parse the sale list.
// This is fully deterministic — the sale title contains the exact sale number.
// Fallback: Google search (for firms without a known profile ID).

function extractNbSaleIdFromFirmPage(html, targetSaleNum, targetYear) {
  // Sale links look like: href="/sale/10365" with surrounding text "CNG 112"
  // or href="/event/10365" (older URLs, both work)
  const saleNumStr = String(targetSaleNum);
  const linkRe = /href="\/(sale|event)\/(\d+)[^"]*"[^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const saleId = parseInt(m[2]);
    const label  = m[3].trim();
    // The label must contain the sale number as an isolated token
    // Use word-boundary-style check: preceded/followed by non-digit
    const numRe = new RegExp('(?<![\d])' + saleNumStr + '(?![\d])');
    if (!numRe.test(label)) continue;
    // If we have a year, check a slightly wider context for it
    if (targetYear) {
      const pos = m.index;
      const context = html.slice(pos, pos + 400);
      if (!context.includes(String(targetYear))) continue;
    }
    return saleId;
  }
  return null;
}

function buildGoogleQuery(parsed) {
  // Target the sale index page, not lot pages.
  // - Use site:numisbids.com/sale to exclude lot pages (which often cite other sales in descriptions)
  // - No quotes: matches page title tokens rather than exact body text
  // - For Roman numeral sales, search the original string (e.g. "XLVIII") not the integer (48)
  //   since NumisBids titles use the Roman numeral form
  const h = parsed.house.replace(/[&'.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const saleToken = parsed.saleRaw || String(parsed.saleNumber);
  const parts = [`site:numisbids.com`, h, saleToken];
  if (parsed.year) parts.push(String(parsed.year));
  return parts.join(' ');
}

function extractCandidatesFromGoogle(html) {
  const patterns = [
    // Modern URL format: /sale/NNNN
    /href="\/url\?q=https?:\/\/(?:www\.)?numisbids\.com\/sale\/(\d+)/gi,
    /href="https?:\/\/(?:www\.)?numisbids\.com\/sale\/(\d+)/gi,
    /numisbids\.com%2Fsale%2F(\d+)/gi,
    /numisbids\.com\/sale\/(\d+)/gi,
    // Legacy URL format: n.php?p=sale&sid=NNNN or n.php?p=lot&sid=NNNN
    /numisbids\.com%2Fn\.php%3Fp%3D(?:sale|lot)%26(?:amp;)?sid%3D(\d+)/gi,
    /numisbids\.com\/n\.php\?p=(?:sale|lot)&(?:amp;)?sid=(\d+)/gi,
    /href="\/url\?q=https?:\/\/(?:www\.)?numisbids\.com\/n\.php[^"]*sid=(\d+)/gi,
  ];
  const seen = new Set();
  const candidates = [];
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(html)) !== null) {
      const id = parseInt(m[1]);
      if (id > 0 && !seen.has(id)) { seen.add(id); candidates.push(id); }
    }
  }
  return candidates;
}

// Fetch a NumisBids sale page and check its heading matches the expected house+sale.
// Returns true if the page confirms the sale, false otherwise.
async function validateNbSalePage(saleId, parsed) {
  try {
    // Try modern URL first, fall back to legacy n.php format
    let resp = await fetch(`https://www.numisbids.com/sale/${saleId}`, {
      headers: { 'User-Agent': navigator.userAgent }
    });
    if (!resp.ok) {
      resp = await fetch(`https://www.numisbids.com/n.php?p=sale&sid=${saleId}`, {
        headers: { 'User-Agent': navigator.userAgent }
      });
    }
    if (!resp.ok) return false;
    const html = await resp.text();
    return nbSalePageMatchesParsed(html, parsed);
  } catch (e) {
    return false;
  }
}

function nbSalePageMatchesParsed(html, parsed) {
  // Validate ONLY against the page title — the body contains lot descriptions
  // which frequently cite other sales by number, causing false positives.
  // Title format: "Firm Name - Sale Title YYYY" or "NumisBids: Firm Name Sale Title, Lot N"
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleM) return false;
  const title = titleM[1].toLowerCase();

  // Strip date expressions from title before number-matching to avoid
  // day numbers (e.g. "28 Jul 2022") false-matching sale numbers.
  // Also strip 4-digit years and lot numbers ("Lot N") to reduce noise.
  const titleForNumberCheck = title
    .replace(/\(?\d{1,2}[-\s]+\d{1,2}[\s-]+[a-z]{3,}[\s-]+\d{4}\)?/gi, '') // (29-30 Mar 2023)
    .replace(/\(?\d{1,2}[\s-]+[a-z]{3,}[\s-]+\d{4}\)?/gi, '')               // (28 Jul 2022)
    .replace(/\(\d{1,2}[-\s]*\)/g, '')                                          // leftover (29-) paren remnants
    .replace(/,?\s*lot\s+\d+/gi, '')                                            // Lot 457
    .replace(/\b\d{4}\b/g, '');                                                 // 2022

  const checkText = title; // for house token matching (needs full title)

  // House: at least one significant token must appear in the title/header.
  // We check both the canonical short name (e.g. "NAC") and the long-form
  // AC company name (e.g. "Numismatica Ars Classica") since NumisBids titles
  // use the full firm name even when citations use abbreviations.
  const houseNames = [parsed.house];
  // Add long-form name from AC_COMPANY_IDS reverse lookup
  for (const [name, id] of Object.entries(AC_COMPANY_IDS)) {
    if (id === AC_COMPANY_IDS[parsed.house] && name !== parsed.house) houseNames.push(name);
  }
  const houseTokenSets = houseNames.map(h =>
    h.toLowerCase().replace(/[&.,\']/g, ' ').split(/\s+/)
     .filter(w => w.length > 2 && !['the', 'and', 'von', 'van', 'dei', 'des', 'for'].includes(w))
  );
  const houseFound = houseTokenSets.some(tokens => tokens.some(token => checkText.includes(token)));
  if (!houseFound) return false;

  // Sale number: must appear in the title specifically (not just the body)
  // This prevents "NAC Autumn Sale 2025" passing for "NAC 114" just because
  // lot 114 or a provenance citation "NAC 114" appears in the page body.
  const isRoman = parsed.saleRaw && /^[IVXLCDM]+$/i.test(parsed.saleRaw) && parsed.saleRaw !== String(parsed.saleNumber);

  // Also try converting arabic sale number to Roman numeral in case the
  // page title uses Roman numerals (e.g. Roma "Auction XXVIII" for sale 28)
  function toRoman(n) {
    const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
    const syms = ['m','cm','d','cd','c','xc','l','xl','x','ix','v','iv','i'];
    let r = '';
    for (let i = 0; i < vals.length; i++) { while (n >= vals[i]) { r += syms[i]; n -= vals[i]; } }
    return r;
  }

  if (isRoman) {
    const romanRe = new RegExp('(?<![a-z])' + parsed.saleRaw.toLowerCase() + '(?![a-z])');
    if (romanRe.test(titleForNumberCheck)) return true;
    const numRe = new RegExp('(?<![0-9])' + String(parsed.saleNumber) + '(?![0-9])');
    return numRe.test(titleForNumberCheck);
  } else {
    const numRe = new RegExp('(?<![0-9])' + String(parsed.saleNumber) + '(?![0-9])');
    if (numRe.test(titleForNumberCheck)) return true;
    // Try Roman numeral equivalent (e.g. 28 → xxviii for Roma Numismatics)
    const roman = toRoman(parsed.saleNumber);
    if (roman.length > 1) {
      const romanRe = new RegExp('(?<![a-z])' + roman + '(?![a-z])');
      return romanRe.test(titleForNumberCheck);
    }
    return false;
  }
}

async function resolveNumisBids(parsed) {
  const cacheKey = nbCacheKey(parsed.house, parsed.saleNumber);
  const cached = await get(cacheKey);
  if (cached !== null) return { saleId: cached, source: 'cached' };

  const firmId = NB_FIRM_IDS[parsed.house];

  // Primary: firm profile page (deterministic, when sale is recent enough)
  if (firmId) {
    try {
      const resp = await fetch(`https://www.numisbids.com/firmprofile/${firmId}`, {
        headers: { 'User-Agent': navigator.userAgent }
      });
      if (resp.ok) {
        const html = await resp.text();
        const saleId = extractNbSaleIdFromFirmPage(html, parsed.saleNumber, parsed.year);
        if (saleId) {
          await set(cacheKey, saleId);
          return { saleId, source: 'firmprofile' };
        }
      }
    } catch (e) {
      console.warn('[NumisResolver] firm profile fetch failed:', e.message);
    }
  }

  // Fallback: Google + validation
  // Collect all candidate sale IDs from Google results, then fetch each
  // candidate page and verify the heading matches the expected house+sale.
  try {
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(buildGoogleQuery(parsed))}`;
    const resp = await fetch(googleUrl, {
      headers: { 'User-Agent': navigator.userAgent, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
    });
    if (!resp.ok) return { saleId: null, source: 'google_error' };
    const html = await resp.text();
    const candidates = extractCandidatesFromGoogle(html);
    console.log('[NumisResolver] Google candidates:', candidates);

    for (const saleId of candidates) {
      const valid = await validateNbSalePage(saleId, parsed);
      console.log('[NumisResolver] Validating sale', saleId, '→', valid);
      if (valid) {
        await set(cacheKey, saleId);
        return { saleId, source: 'google_validated' };
      }
    }
    return { saleId: null, source: 'not_found' };
  } catch (e) {
    console.warn('[NumisResolver] Google fallback failed:', e.message);
    return { saleId: null, source: 'error' };
  }
}

// ── ACSEARCH LOOKUP ────────────────────────────────────────────────────────

async function resolveACSearch(parsed) {
  const companyId = AC_COMPANY_IDS[parsed.house];
  if (!companyId) return { companyId: null, auctionId: null };

  const cacheKey = acCacheKey(parsed.house, parsed.saleNumber);
  const cached = await get(cacheKey);
  if (cached !== null) return { companyId, auctionId: cached };

  // Fetch the auction list for this company
  const url = `https://www.acsearch.info/auctions.html?company=${companyId}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': navigator.userAgent, 'Accept': 'text/html' }
    });
    if (!resp.ok) return { companyId, auctionId: null };
    const html = await resp.text();
    const auctionId = extractAcAuctionId(html, parsed.saleNumber, parsed.year);
    if (auctionId) await set(cacheKey, auctionId);
    return { companyId, auctionId };
  } catch (e) {
    console.warn('[NumisResolver] ACSearch lookup failed:', e.message);
    return { companyId, auctionId: null };
  }
}

function extractAcAuctionId(html, targetSaleNum, targetYear) {
  // Auction list rows look like:
  //   <a href="search.html?term=&company=47&auction=5236">Auction 257</a>
  // followed by the date somewhere nearby.
  const saleNumStr = String(targetSaleNum);
  const linkRe = /href="search\.html\?[^"]*auction=(\d+)[^"]*">([^<]+)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const auctionId = parseInt(m[1]);
    const label = m[2].trim();
    // Label should contain the sale number as a standalone word/number
    // e.g. "Auction 257" or "Online Auction 257" or "E-Sale 257"
    const numsInLabel = label.match(/\b(\d+)\b/g) || [];
    if (!numsInLabel.includes(saleNumStr)) continue;
    // If year provided, check surrounding context for that year
    if (targetYear) {
      const pos = m.index;
      const context = html.slice(pos, pos + 300);
      if (!context.includes(String(targetYear))) continue;
    }
    return auctionId;
  }
  return null;
}

// ── KNOWN PREMIUM LOOKUP ──────────────────────────────────────────────────

async function lookupKnownPremium(firmRaw) {
  // Check user overrides first — return with isOverride flag so caller can
  // bypass the per-sale cache and always respect the latest user setting.
  const allStorage = await new Promise(r => chrome.storage.local.get(null, r));
  const firmNorm = firmRaw.toLowerCase().replace(/[&.,'-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [k, v] of Object.entries(allStorage)) {
    if (!k.startsWith('nb_premium_override::')) continue;
    const overrideHouse = k.slice('nb_premium_override::'.length);
    const overrideNorm = overrideHouse.toLowerCase().replace(/[&.,'-]/g, ' ').replace(/\s+/g, ' ').trim();
    // Exact match first
    if (overrideNorm === firmNorm) return { premium: v, isOverride: true, confidence: 'confirmed' };
    // Fuzzy: all words of the override key appear as whole words in firmRaw
    const words = overrideNorm.split(' ').filter(Boolean);
    if (words.length > 0 && words.every(w => new RegExp('(?<![a-z])' + w + '(?![a-z])').test(firmNorm)))
      return { premium: v, isOverride: true, confidence: 'confirmed' };
  }

  if (firmRaw in KNOWN_PREMIUMS) return { premium: KNOWN_PREMIUMS[firmRaw], isOverride: false, confidence: 'tentative' };

  const norm = firmRaw.toLowerCase().replace(/[&.,'-]/g, ' ').replace(/\s+/g, ' ').trim();

  // Sort keys longest-first so more specific keys match before short ones like 'NAC'
  const keys = Object.keys(KNOWN_PREMIUMS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const keyNorm = key.toLowerCase().replace(/[&.,'-]/g, ' ').replace(/\s+/g, ' ').trim();
    // Require word-boundary match: key tokens must appear as whole words in firm name
    const keyWords = keyNorm.split(' ').filter(Boolean);
    const allMatch = keyWords.every(w => new RegExp('(?<![a-z])' + w + '(?![a-z])').test(norm));
    if (allMatch) return { premium: KNOWN_PREMIUMS[key], isOverride: false, confidence: 'tentative' };
  }
  return { premium: undefined, isOverride: false, confidence: 'tentative' };
}


// ── MESSAGE HANDLER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ALL_PREMIUMS') {
    // Return a deduplicated table for the popup UI.
    // Aliases (e.g. 'Classical Numismatic Group', 'Classical Numismatic Group, Inc.')
    // map to the same value as their canonical name ('CNG') — we only show the
    // canonical name by keeping the first key seen for each unique value+name group.
    // We define canonical names explicitly; aliases are purely for lookup.
    const CANONICAL = [
      'NAC', 'CNG', 'Triton', 'Gorny & Mosch', 'Künker', 'Leu Numismatik',
      'Nomos', 'Roma Numismatics', 'Naville Numismatics', 'Bertolami Fine Arts',
      'Nomisma', 'Numismatik Naumann', 'Savoca', 'Hirsch', 'Dr. Busso Peus',
      'Jean Elsen', 'Sincona', 'MDC Monaco', 'Solidus', 'Teutoburger',
      'Kölner Münzkabinett', 'Numismatik Lanz', 'LHS Numismatik', 'Hess-Divo',
      'Adolph Hess', 'Münzen & Medaillen', 'Numismatica Genevensis',
      "Stack's Bowers", 'Heritage Auctions', 'Spink', 'Morton & Eden',
      'Stephen Album', 'Agora Auctions', 'Pegasi Numismatics', 'Artemide Aste',
      'Freeman & Sear', 'Davissons', 'A. Tkalec',
    ];
    const display = {};
    for (const name of CANONICAL) {
      if (name in KNOWN_PREMIUMS) display[name] = KNOWN_PREMIUMS[name];
    }
    sendResponse(display);
    return false;
  }

  if (message.type === 'GET_KNOWN_PREMIUM') {
    (async () => {
      try {
        let firmRaw = '';

        if (message.firmNameHint) {
          // Watchlist: firm name already extracted from DOM, skip page fetch
          firmRaw = message.firmNameHint;
        } else {
          // Lot page: fetch sale index to extract firm name from title
          const resp = await fetch(`https://www.numisbids.com/sale/${message.saleId}`, {
            headers: { 'User-Agent': navigator.userAgent }
          });
          if (!resp.ok) { sendResponse({}); return; }
          const html = await resp.text();
          const titleTag = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
          const decoded = titleTag.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
          const dashM = decoded.match(/^([^-]+?)\s+-\s+/);
          const nbM = decoded.match(/NumisBids:\s*([^-<,]+?)(?:\s*[-,]|\s*Sale|\s*Auction|\s*Lot)/i);
          firmRaw = (dashM?.[1] || nbM?.[1] || '').trim();
          if (!firmRaw) { sendResponse({}); return; }
        }

        const { premium, isOverride, confidence } = await lookupKnownPremium(firmRaw);
        console.log('[NumisResolver] Known premium for', firmRaw, ':', premium, isOverride ? '(override)' : '');
        // Clean up firmRaw for use as display name / confirm key:
        // strip trailing sale qualifiers (eLive, Auction, E-Auction, Online, etc.)
        // then resolve to the canonical KNOWN_PREMIUMS key if possible
        let displayName = firmRaw
          // Strip trailing sale qualifiers, including standalone "E" prefix left over
          // from split hyphenated forms like "E-Auction" → title splits to "Firm E"
          .replace(/\s+(?:e[-\s]?(?:live|auction|sale|auktion)|elive|electronic(?:\s+auction)?|auction|auktion|online|live|floor|sale|web)\s*$/i, '')
          .replace(/(\s)E\s*$/, '$1').replace(/^(.+)\sE$/, '$1')
          .trim();
        // Try to find the canonical key that matched
        const dispNorm = displayName.toLowerCase().replace(/[&.,'-]/g, ' ').replace(/\s+/g, ' ').trim();
        const canonKey = Object.keys(KNOWN_PREMIUMS).sort((a,b) => b.length-a.length).find(k => {
          const kn = k.toLowerCase().replace(/[&.,'-]/g, ' ').replace(/\s+/g, ' ').trim();
          const words = kn.split(' ').filter(Boolean);
          return words.length > 0 && words.every(w => new RegExp('(?<![a-z])'+w+'(?![a-z])').test(dispNorm));
        });
        const firmName = canonKey || displayName;
        sendResponse({ premium, isOverride, confidence, _firmName: firmName });
      } catch (e) {
        sendResponse({});
      }
    })();
    return true;
  }


  if (message.type === 'CONFIRM_PREMIUM_SALE') {
    // User confirmed premium for a specific sale ID
    const key = `nb_confirmed_sale::${message.saleId}`;
    chrome.storage.local.set({ [key]: { pct: message.pct, house: message.house } }, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'CONFIRM_PREMIUM_HOUSE') {
    // User confirmed premium for all sales by a house — write to override
    const key = `nb_premium_override::${message.house}`;
    chrome.storage.local.set({ [key]: message.pct }, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'GET_CONFIRMED_PREMIUMS') {
    // Return all house-level confirmed premiums for popup display
    chrome.storage.local.get(null, items => {
      const result = {};
      for (const [k, v] of Object.entries(items)) {
        if (k.startsWith('nb_premium_override::'))
          result[k.slice('nb_premium_override::'.length)] = v;
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.type !== 'RESOLVE_LOT') return false;

  const { parsed } = message;
  // saleNumber may be null for date-based citations (Tkalec, Sotheby's etc)
  // Only bail if there's no house or no way to identify the sale at all
  if (!parsed?.house || (!parsed?.saleNumber && !parsed?.year)) {
    sendResponse({ nb: { saleId: null }, ac: { companyId: null, auctionId: null } });
    return true;
  }

  (async () => {
    const [nb, ac] = await Promise.all([
      resolveNumisBids(parsed),
      resolveACSearch(parsed),
    ]);
    console.log('[NumisResolver] NB:', nb, '| AC:', ac);
    sendResponse({ nb, ac });
  })();

  return true;
});
