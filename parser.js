// parser.js
// Parses auction provenance citations into structured data.
//
// Handles formats like:
//   "Gorny & Mosch 257, 2018, 357"
//   "CNG 100, September 2015, lot 450"
//   "Nomos 15, 2017, 245"
//   "NAC 84, 2015, 526"
//   "Roma Numismatics XIV, 2017, 456"
//   "Leu 7, 2020, 312"
//   "Savoca 12, 2018, 103"
//   "Thierry Parsy 23, March 2016, 26"   (sale # ambiguous)
//   "Sotheby's, 14 October 1985, lot 432" (date-based, no sale #)

(function() {

  // Known auction house name aliases → canonical name
  // Add more as needed
  const HOUSE_ALIASES = {
    // Gorny & Mosch
    'gorny': 'Gorny & Mosch',
    'gorny & mosch': 'Gorny & Mosch',
    'gorny and mosch': 'Gorny & Mosch',
    'gm': 'Gorny & Mosch',

    // CNG
    'cng': 'CNG',
    'classical numismatic group': 'CNG',

    // NAC
    'nac': 'NAC',
    'numismatica ars classica': 'NAC',

    // Nomos
    'nomos': 'Nomos',
    'nomos ag': 'Nomos',
    'nomos obolos': 'Nomos', 'nomos obolos web auction': 'Nomos',
    'nomos web auction': 'Nomos', 'obolos': 'Nomos', 'obolos web auction': 'Nomos',

    // Roma
    'roma': 'Roma Numismatics',
    'roma numismatics': 'Roma Numismatics',

    // Savoca
    'savoca': 'Savoca',
    'savoca numismatica': 'Savoca',
    'savoca coins': 'Savoca',

    // Leu
    'leu': 'Leu',
    'leu numismatik': 'Leu',

    // Münzen & Medaillen
    'munzen': 'Münzen & Medaillen',
    'münzen': 'Münzen & Medaillen',
    'm&m': 'Münzen & Medaillen',
    'münzen & medaillen': 'Münzen & Medaillen',

    // Künker (Fritz Rudolf Künker)
    'kuenker': 'Künker',
    'künker': 'Künker',
    'kunker': 'Künker',
    'fritz rudolf künker': 'Künker',
    'fritz rudolf kuenker': 'Künker',

    // Gerhard Hirsch Nachfolger
    'hirsch': 'Hirsch',
    'gerhard hirsch': 'Hirsch',
    'hirsch nachf': 'Hirsch',
    'hirsch nachf.': 'Hirsch',
    'hirsch nachfolger': 'Hirsch',
    'gerhard hirsch nachfolger': 'Hirsch',
    'gerhard hirsch nachf': 'Hirsch',
    'gerhard hirsch nachf.': 'Hirsch',
    'münzenhandlung hirsch': 'Hirsch',
    'g. hirsch nachfolger': 'Hirsch',

    // Jean Elsen & ses Fils
    'elsen': 'Jean Elsen',
    'jean elsen': 'Jean Elsen',
    "jean elsen & ses fils": 'Jean Elsen',

    // Spink
    'spink': 'Spink',

    // Sothebys
    "sotheby's": "Sotheby's",
    'sothebys': "Sotheby's",

    // Christie's
    "christie's": "Christie's",
    'christies': "Christie's",

    // Ars Classica (older firm, different from NAC)
    'ars classica': 'Ars Classica',

    // Hess-Divo
    'hess-divo': 'Hess-Divo',
    'hess divo': 'Hess-Divo',

    // Peus (Dr. Busso Peus Nachfolger)
    'peus': 'Dr. Busso Peus',
    'busso peus': 'Dr. Busso Peus',
    'busso-peus': 'Dr. Busso Peus',
    'peus nachf': 'Dr. Busso Peus',
    'peus nachf.': 'Dr. Busso Peus',
    'dr. busso peus': 'Dr. Busso Peus',
    'dr. busso peus nachf': 'Dr. Busso Peus',
    'dr. busso peus nachf.': 'Dr. Busso Peus',
    'dr. busso peus nachfolger': 'Dr. Busso Peus',

    // Gitbud & Naumann (now Naumann)
    'gitbud': 'Gitbud & Naumann',
    'naumann': 'Gitbud & Naumann',
    'gitbud & naumann': 'Gitbud & Naumann',

    // Schulman
    'schulman': 'Schulman',

    // Triton (CNG series)
    'triton': 'Triton',

    // LHS
    'lhs': 'LHS Numismatik',
    'lhs numismatik': 'LHS Numismatik',

    // Aureo
    'aureo': 'Aureo & Calico',
    'aureo & calico': 'Aureo & Calico',

    // Bertolami
    'bertolami': 'Bertolami Fine Arts',
    'bertolami fine arts': 'Bertolami Fine Arts',

    // Numismatica Genevensis
    'numismatica genevensis': 'Numismatica Genevensis',

    // Stack's
    "stack's": "Stack's",
    'stacks': "Stack's",
    "stack's bowers": "Stack's Bowers",
    'stacks bowers': "Stack's Bowers",

    // Thierry Parsy
    'parsy': 'Thierry Parsy',
    'thierry parsy': 'Thierry Parsy',

    // CNG series qualifiers (when written as "CNG, E-auction 461")
    'cng e-auction': 'CNG',
    'cng e auction': 'CNG',
    'cng electronic auction': 'CNG',
    'cng triton': 'CNG',
    'cng mail bid sale': 'CNG',
    'cng mbs': 'CNG',

    // NAC series qualifiers
    'nac auction': 'NAC',
    'numismatica ars classica auction': 'NAC',

    // Artemide Aste
    'artemide': 'Artemide Aste',
    'artemide aste': 'Artemide Aste',

    // Naville Numismatics
    'naville': 'Naville Numismatics',
    'naville numismatics': 'Naville Numismatics',

    // Numismatik Naumann / Gitbud & Naumann
    'naumann': 'Numismatik Naumann',
    'numismatik naumann': 'Numismatik Naumann',
    'gitbud & naumann': 'Numismatik Naumann',
    'gitbud and naumann': 'Numismatik Naumann',

    // Leu variants
    'leu numismatik ag': 'Leu Numismatik',
    'bank leu': 'Bank Leu',
    'leu winterthur': 'Bank Leu',

    // CNG sale series qualifiers — all map to CNG
    'cng ea': 'CNG',
    'cng e-sale': 'CNG',
    'cng electronic auction': 'CNG',
    'cng mail bid sale': 'CNG',
    'cng mbs': 'CNG',

    // Roma E-Sale
    'roma e-sale': 'Roma Numismatics',
    'roma esale': 'Roma Numismatics',

    // Hirsch variants
    'hirsch nachfolger': 'Hirsch',
    'gerhard hirsch nachfolger': 'Hirsch',
    'dr. jacob hirsch': 'Hirsch',
    'jacob hirsch': 'Hirsch',

    // Morton & Eden
    'morton & eden': 'Morton & Eden',

    // Numismatica Ars Classica
    'nac ag': 'NAC',

    // Münzen & Medaillen variants
    'munzen & medaillen': 'Münzen & Medaillen',
    'münzen und medaillen': 'Münzen & Medaillen',
    'munzen und medaillen': 'Münzen & Medaillen',
    'mm': 'Münzen & Medaillen',

    // Numismatik Lanz
    'lanz': 'Numismatik Lanz',
    'numismatik lanz': 'Numismatik Lanz',
    'numismatik lanz münchen': 'Numismatik Lanz',

    // Hess variants
    'hess': 'Hess-Divo',
    'adolph hess': 'Adolph Hess',
    'adolph hess ag': 'Adolph Hess',

    // Sincona
    'sincona': 'Sincona',

    // Solidus
    'solidus': 'Solidus',
    'solidus numismatik': 'Solidus',

    // Agora
    'agora': 'Agora Auctions',
    'agora auctions': 'Agora Auctions',

    // Numismatica Genevensis
    'ngsa': 'Numismatica Genevensis',

    // Pegasi
    'pegasi': 'Pegasi Numismatics',
    'pegasi numismatics': 'Pegasi Numismatics',

    // Freeman & Sear
    'freeman & sear': 'Freeman & Sear',
    'freeman and sear': 'Freeman & Sear',

    // Heritage
    'heritage': 'Heritage Auctions',
    'heritage auctions': 'Heritage Auctions',

    // Bruun Rasmussen
    'bruun rasmussen': 'Bruun Rasmussen',

    // Tkalec (date-based sales, no sale number)
    'tkalec': 'A. Tkalec',
    'a. tkalec': 'A. Tkalec',
    'tkalec ag': 'A. Tkalec',
    'a. tkalec ag': 'A. Tkalec',

    // Frank Sternberg (Zürich, date-based)
    'sternberg': 'Sternberg',
    'frank sternberg': 'Sternberg',

    // Ars Antiqua (Lucerne, date-based)
    'ars antiqua': 'Ars Antiqua',

    // Bank Leu / Leu Numismatik older sales
    'bank leu': 'Bank Leu',
    'leu winterthur': 'Bank Leu',

    // German house name qualifier variants
    'leu auktion': 'Leu Numismatik',
    'künker auktion': 'Künker',
    'künker elive': 'Künker', 'künker elive auction': 'Künker',
    'künker auction elive': 'Künker',
    'fritz rudolf künker auction elive': 'Künker',
    'fritz rudolf künker auction': 'Künker',
    'fritz rudolf künker elive': 'Künker', 'fritz rudolf künker elive auction': 'Künker',
    'kuenker auktion': 'Künker',
    'gorny & mosch auktion': 'Gorny & Mosch',
    'hirsch auktion': 'Hirsch',
    'rauch auktion': 'Rauch',
    'numismatik naumann auktion': 'Numismatik Naumann',
    'teutoburger münzauktion': 'Teutoburger',
    'münzzentrum rheinland': 'Münz Zentrum Rheinland',
    'schulten': 'Kölner Münzkabinett',
    'lhs': 'LHS Numismatik',
  };

  const ROMAN_NUMERALS = {
    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7,
    'VIII': 8, 'IX': 9, 'X': 10, 'XI': 11, 'XII': 12, 'XIII': 13,
    'XIV': 14, 'XV': 15, 'XVI': 16, 'XVII': 17, 'XVIII': 18,
    'XIX': 19, 'XX': 20, 'XXI': 21, 'XXII': 22, 'XXIII': 23, 'XXIV': 24,
    'XXV': 25, 'XXVI': 26, 'XXVII': 27, 'XXVIII': 28, 'XXIX': 29,
    'XXX': 30, 'XXXI': 31, 'XXXII': 32, 'XXXIII': 33, 'XXXIV': 34,
    'XXXV': 35, 'XXXVI': 36, 'XXXVII': 37, 'XXXVIII': 38, 'XXXIX': 39,
    'XL': 40, 'XLI': 41, 'XLII': 42, 'XLIII': 43, 'XLIV': 44,
    'XLV': 45, 'XLVI': 46, 'XLVII': 47, 'XLVIII': 48, 'XLIX': 49,
    'L': 50, 'LI': 51, 'LII': 52, 'LIII': 53, 'LIV': 54, 'LV': 55,
    'LVI': 56, 'LVII': 57, 'LVIII': 58, 'LIX': 59, 'LX': 60,
    'LXI': 61, 'LXII': 62, 'LXIII': 63, 'LXIV': 64, 'LXV': 65,
    'LXVI': 66, 'LXVII': 67, 'LXVIII': 68, 'LXIX': 69, 'LXX': 70,
    'LXXI': 71, 'LXXII': 72, 'LXXIII': 73, 'LXXIV': 74, 'LXXV': 75,
    'LXXVI': 76, 'LXXVII': 77, 'LXXVIII': 78, 'LXXIX': 79, 'LXXX': 80,
    'LXXXI': 81, 'LXXXII': 82, 'LXXXIII': 83, 'LXXXIV': 84, 'LXXXV': 85,
    'LXXXVI': 86, 'LXXXVII': 87, 'LXXXVIII': 88, 'LXXXIX': 89, 'XC': 90,
    'XCI': 91, 'XCII': 92, 'XCIII': 93, 'XCIV': 94, 'XCV': 95,
    'XCVI': 96, 'XCVII': 97, 'XCVIII': 98, 'XCIX': 99, 'C': 100,
  };

  function parseRoman(str) {
    return ROMAN_NUMERALS[str.toUpperCase()] || null;
  }

  function canonicalizeHouse(raw) {
    // Strip trailing punctuation (e.g. "NOMOS," from ACSearch format "NOMOS, AUCTION 35, LOT 571")
    const cleaned = raw.trim().replace(/[,.:;]+$/, '').trim();
    const key = cleaned.toLowerCase().replace(/\s+/g, ' ');
    return HOUSE_ALIASES[key] || cleaned;
  }

  /**
   * Main parse function.
   * Returns null if the text doesn't look like a provenance citation,
   * or an object: { house, saleNumber, saleRaw, year, lotNumber, raw }
   *
   * saleNumber is an integer if parsed, null if date-based.
   * year is a 4-digit integer if present, null otherwise.
   */
  function parseProvenance(text) {
    text = text.trim().replace(/\s+/g, ' ');

    // Strip known city qualifiers that appear after a comma in the house name
    // e.g. "Tkalec, Zürich 29. Februar 2008" → "Tkalec 29. Februar 2008"
    // e.g. "Sternberg, Zürich 1987" → "Sternberg 1987"
    const CITY_SUFFIXES = /,\s*(Zürich|Zurich|München|Munich|Berlin|Frankfurt(?:\s+am\s+Main|\/Main)?|Basel|Geneva|Genf|Genève|London|New York|Lugano|Bern|Vienna|Wien|Paris|Rome|Roma|Milan|Milano|Hannover|Hamburg|Stuttgart|Köln|Cologne|Düsseldorf|Leipzig|Dresden|Heidelberg|Wiesbaden|Mainz|Auktion)(?=[\s,]|$)/gi;
    // Replace ", City" with "," — keeps the comma as date separator
    text = text.replace(CITY_SUFFIXES, ',');
    // Also strip inline city/location tokens that appear directly before a year
    // e.g. "Frankfurt/Main 2002" → "2002", "Frankfurt am Main 2018" → "2018"
    // This handles cases like "Peus Nachf. 371, Frankfurt/Main 2002, Nr. 1614"
    const INLINE_CITY = /\b(?:Frankfurt(?:\/Main|\s+am\s+Main)?|Zürich|Zurich|München|Munich|Berlin|Basel|London|Paris|Wien|Vienna|Lugano|Bern|Hannover|Hamburg|Stuttgart|Köln|Düsseldorf|Leipzig|Heidelberg|New\s+York)\s+(?=\d{4})/gi;
    text = text.replace(INLINE_CITY, '');
    text = text.trim().replace(/,\s*,/g, ',').replace(/\s+/g, ' ');
    // Strip trailing sale qualifiers (e.g. "Auction 436 eLive" → "Auction 436")
    text = text.replace(/\b(\d+)\s+(?:elive|e-live|online|live|floor)(?=\s*,|\s*$)/gi, '$1');
    // Strip E/e prefix from e-auction sale numbers: "E583" → "583", "E-583" → "583"
    text = text.replace(/\b[Ee]-?(\d{3,})\b/g, '$1');

    function makeResult(houseRaw, saleRaw, yearStr, lotStr, raw, dateStr) {
      const saleNumber = /^\d+$/.test(saleRaw) ? parseInt(saleRaw, 10) : (parseRoman(saleRaw) || saleRaw);
      const year = yearStr ? parseInt(yearStr, 10) : null;
      const lotNumber = parseInt(lotStr, 10);
      const house = canonicalizeHouse(houseRaw);
      if (!isValidHouse(house) || !(lotNumber > 0)) return null;
      return Object.assign({ house, saleNumber, saleRaw, year, lotNumber, raw },
                            dateStr ? { dateStr } : {});
    }

    let m;

    // Pattern 0: "House, SeriesQualifier SALE#, DATE, [lot] LOT#"
    // e.g. "CNG, E-auction 461, 12 février 2020, 340"
    // e.g. "CNG, Electronic Auction 461, 12 February 2020, lot 340"
    // e.g. "CNG, Triton XXIII, 14 January 2020, lot 340"
    // e.g. "NAC, Auction 84, Spring 2015, lot 526"
    // The house and its sale-series qualifier are separated by a comma.
    // We re-join them into a single "house + qualifier" string for canonicalization.
    m = text.match(/^([^\d,]+?),\s*([^\d,]+?)\s+(\d+|[IVXLCDM]{1,8}),\s*(?:\d{1,2}\.?\s*)?(?:[\wÀ-ɏ]+\.?\s+)?(\d{4}),\s*(?:(?:lot|los|nr\.?)\s+)?(\d+)$/i);
    if (m) {
      const combinedHouse = (m[1] + ' ' + m[2]).trim();
      const r = makeResult(combinedHouse, m[3], m[4], m[5], text);
      if (r) return r;
      // Also try just the first part as the house (series qualifier as noise)
      const r2 = makeResult(m[1].trim(), m[3], m[4], m[5], text);
      if (r2) return r2;
    }

    // Pattern 0b: "House, QUALIFIER SALE#, LOT LOT#" (ACSearch format, no year)
    // e.g. "NOMOS, AUCTION 35, LOT 571"
    // e.g. "NUMISMATICA ARS CLASSICA, AUCTION 152, LOT 9"
    // e.g. "TAULER & FAU SUBASTAS, AUCTION 160, LOT 14"
    m = text.match(/^([^\d,]+?),\s*([^\d,]+?)\s+(\d+|[IVXLCDM]{1,8}),\s*(?:lot|los|nr\.?)\s+(\d+)$/i);
    if (m) {
      const combinedHouse = (m[1] + ' ' + m[2]).trim();
      const r = makeResult(combinedHouse, m[3], null, m[4], text);
      if (r) return r;
      const r2 = makeResult(m[1].trim(), m[3], null, m[4], text);
      if (r2) return r2;
    }

    // Pattern 1a: "House SALE#, [Month] YEAR, [lot] LOT#"
    // e.g. "Gorny & Mosch 257, 2018, 357" or "CNG 100, September 2015, lot 450"
    // Date prefix: optional 'DD.' and/or 'Monthname[.]' before the 4-digit year
    m = text.match(/^([^\d,]+?)\s+(\d+|[IVXLCDM]{1,8}),\s*(?:\d{1,2}[.\s]\s*)?(?:[\w\u00C0-\u024F]+\.?\s+)?(\d{4}),\s*(?:(?:lot|los|nr\.)\s+)?(\d+)$/i);
    if (m) { const r = makeResult(m[1], m[2], m[3], m[4], text); if (r) return r; }

    // Pattern 1b: "House SALE# (DATE), [lot] LOT#"
    // e.g. "Artemide Aste XLVIII (2 December 2017), lot 432"
    m = text.match(/^([^\d,(]+?)\s+(\d+|[IVXLCDM]{1,8})\s*\([^)]*?(\d{4})[^)]*\),\s*(?:(?:lot|los|nr\.?)\s+)?(\d+)$/i);
    if (m) { const r = makeResult(m[1], m[2], m[3], m[4], text); if (r) return r; }

    // Pattern 1c: "House SALE# (DATE) [lot] LOT#"  (no comma after paren)
    // e.g. "Artemide Aste XLVIII (2 December 2017) 432"
    m = text.match(/^([^\d,(]+?)\s+(\d+|[IVXLCDM]{1,8})\s*\([^)]*?(\d{4})[^)]*\)\s+(?:(?:lot|los|nr\.?)\s+)?(\d+)$/i);
    if (m) { const r = makeResult(m[1], m[2], m[3], m[4], text); if (r) return r; }

    // Pattern 2: "House SALE#, [lot] LOT#" (no year)
    // e.g. "CNG 100, 450"
    m = text.match(/^([^\d,]+?)\s+(\d+|[IVXLCDM]{1,8}),\s*(?:(?:lot|los|nr\.?)\s+)?(\d+)$/i);
    if (m) { const r = makeResult(m[1], m[2], null, m[3], text); if (r) return r; }

    // Pattern 3: "House, DATE, [lot] LOT#" (date-based, no sale number)
    // e.g. "Sotheby's, 14 October 1985, lot 432"
    m = text.match(/^([^\d,]+?),\s*([\d\w\s.]+\d{4}),\s*(?:(?:lot|los|nr\.?)\s+)?(\d+)$/i);
    if (m) {
      const houseRaw = m[1];
      const dateStr = m[2].trim();
      const lotNumber = parseInt(m[3], 10);
      const yearMatch = dateStr.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      const house = canonicalizeHouse(houseRaw);
      if (isValidHouse(house) && lotNumber > 0) {
        return { house, saleNumber: null, saleRaw: null, year, lotNumber, raw: text, dateStr };
      }
    }

    return null;
  }

  // Rough sanity check: at least 2 chars and contains a letter
  function isValidHouse(name) {
    // \p{L} matches any Unicode letter (handles ü, ö, é, etc.)
    return name && name.length >= 2 && /\p{L}/u.test(name);
  }

  // Expose globally for content.js
  window.NumisParser = { parseProvenance, canonicalizeHouse };

})();
