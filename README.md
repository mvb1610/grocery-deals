# Niagara Grocery Deals

Scans this week's grocery flyers for the Niagara region and helps plan what to buy and cook.

- `index.html` is the whole app (no build step). It reads the public Flipp flyer feed from the browser.
- Shopping list, staples and settings are stored on each phone.
- On a phone: open the link, then Share → **Add to Home Screen**.

## Weekly scan

`.github/workflows/pages.yml` runs `scripts/scan.mjs` on every push and every morning. It saves `data/extra.json` (specials read from lococos.ca,
which is not on Flipp),
`data/history.json` (each deal's price per week, last 26 weeks; the app uses it for "lowest in N weeks") and
`data/digest.txt` (this week's best prices for the staples in `data/staples.json`), then deploys the site.

## Shared list

Sign-in and the shared shopping list use the Plate Ledger Firebase project (`grocery/{listId}` documents, readable and
writable only by the people in that list's `members`).
