# Numismatic Provenance Resolver

A Chrome extension for ancient coin collectors. It does two things:

1. **Provenance lookup** — highlight a citation like `CNG 100, September 2015, lot 450` on any webpage and a button appears to jump directly to that lot on [NumisBids](https://www.numisbids.com) or [ACSearch](https://www.acsearch.info).

2. **Buyer's premium calculator** — on NumisBids lot and watchlist pages, and on [Biddr](https://www.biddr.com) live auctions, shows the all-in price including buyer's premium next to every hammer price.

---

## Installation

Chrome does not allow installing extensions from outside the Web Store without enabling developer mode. This is a one-time step.

1. Download this repository as a ZIP (green **Code** button → **Download ZIP**) and unzip it somewhere permanent — don't delete the folder after installing.
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the unzipped folder
5. The 🏛️ icon will appear in your toolbar

> Chrome will show a banner on startup saying developer mode extensions are enabled — this is normal for extensions installed this way.

To update: replace the folder contents with the new files, then go to `chrome://extensions` and click the refresh icon on the extension card.

---

## Provenance lookup

Highlight any auction citation on any webpage and a **Find Lot** button appears. Click it to open the lot on NumisBids and/or ACSearch.

**Formats recognised:**

- `Gorny & Mosch 257, 2018, 357`
- `CNG 100, September 2015, lot 450`
- `CNG E583, 19 March 2025, lot 566`
- `Roma Numismatics XIV, 2017, 456`
- `Nomos, Obolos Web Auction 38, lot 508`
- `Künker, eLive Auction 435, lot 9254`
- `Künker, Auction 436 eLive, lot 10344`
- `Jean Elsen 142, 14 September 2019, lot 161`
- `NAC 84, 2015, 526`
- `Sotheby's, 14 October 1985, lot 432`

If a citation doesn't resolve, you can manually enter the NumisBids sale ID via the popup (🏛️ → **Manual Cache Entry**). The **Test Parser** field lets you check whether a citation will parse correctly before trying it on a page.

---

## Buyer's premium calculator

### NumisBids lot pages

The extension shows the all-in price next to estimates and prices realized:

> Estimate: 500 EUR → 600 EUR (+20%)

**Tentative vs confirmed**

Premiums from the built-in table or terms pages are shown as tentative with a `?` and an editable field:

> Estimate: 500 EUR → 600 EUR (20 %?)  
> `[✓ Sale]` `[✓ Nomos]`

- Edit the percentage if it's wrong — the total updates live
- **✓ Sale** — confirms for this sale only
- **✓ HouseName** — confirms for all sales by that house

Once confirmed, the `?` disappears. A ✎ button lets you re-edit. House-level confirmed premiums appear in the popup where you can edit or remove them.

### NumisBids watchlist

All watched lots are annotated with their buyer's premium. Tentative rates show `(+20%?)` in italic; confirmed rates show `(+20%)` normally. Confirm rates via individual lot pages — the watchlist doesn't show confirm buttons to keep it readable.

### Biddr

On Biddr live auction and lot pages a banner asks you to enter the buyer's premium. Once saved it annotates the current bid, currency conversion, and all lot thumbnail hammer prices. A **BP: X%** button in the corner lets you change it.

---

## Supported houses

Most major ancient coin houses are recognised for provenance lookup, including CNG, NAC, Nomos, Künker, Roma Numismatics, Gorny & Mosch, Leu Numismatik, Naville, Bertolami, Savoca, Numismatik Naumann, Stack's Bowers, Heritage, Spink, Stephen Album, and many more. If a house isn't recognised, let us know.

---

## Privacy

Requests are made only to numisbids.com, acsearch.info, google.com (for sale ID lookups), and biddr.com. No data is sent anywhere else. All cached sale IDs and confirmed premiums are stored locally in your browser.
