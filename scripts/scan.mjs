// Weekly flyer scan, run by GitHub Actions. Writes:
//   data/history.json  price of every deal per week (last 26 weeks), read by the app for "lowest in N weeks"
//   data/digest.json / data/digest.txt  this week's best prices for the staples in data/staples.json
import fs from 'node:fs';
import vm from 'node:vm';

const API = 'https://backflipp.wishabi.com/flipp/';
const PCS = ['L2E6X5', 'L2R7C2', 'L3B3X4'];                      // Niagara Falls, St. Catharines, Welland
const SKIP = /^(subway|president's choice|longos)$/i;
const KEEP_WEEKS = 26;
const get = async u => { const r = await fetch(u, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); };

// Reuse the app's own matching rules (the block between these two comments in index.html) so the digest agrees with the app.
const html = fs.readFileSync('index.html', 'utf8');
const seg = html.split('/* ---------- matching ---------- */')[1].split('/* ---------- scanning Flipp ---------- */')[0];
const ctx = vm.createContext({ ITEMS: [], S: { hidden: [] }, Date });
vm.runInContext(seg + '\n;this.norm = norm;', ctx);

// 1. flyers → deals (same rules as the app: grocery flyers, one flyer per chain, priced items only)
const seen = new Map();
for (const pc of PCS) {
  try {
    const d = await get(API + 'flyers?locale=en-ca&postal_code=' + pc);
    for (const f of d.flyers || []) { if (!(f.categories || []).includes('Groceries') || SKIP.test(f.merchant)) continue; const k = f.merchant + '|' + f.name; if (!seen.has(k)) seen.set(k, f); }
  } catch (e) { console.warn(String(e)); }
}
if (!seen.size) { console.error('No flyers reached — leaving data unchanged.'); process.exit(1); }
const items = [], dup = new Set();
for (const f of seen.values()) {
  try {
    const d = await get(API + 'flyers/' + f.id + '?locale=en-ca');
    for (const i of d.items || []) {
      const p = parseFloat(i.price); if (!i.name || !(p > 0)) continue;
      const n = String(i.name).replace(/\s+/g, ' ').trim(), k = f.merchant + '|' + n.toLowerCase() + '|' + p; if (dup.has(k)) continue; dup.add(k);
      items.push({ id: i.id, m: f.merchant, n, p, u: '', pre: '', s: ctx.norm(n + ' ' + (i.brand || '')), e: Date.parse(i.valid_to || f.valid_to) || Infinity, c: 'x' });
    }
  } catch (e) { console.warn(String(e)); }
}
console.log(`${items.length} deals from ${seen.size} flyers`);
if (items.length < 200) { console.error('Too few deals — leaving data unchanged.'); process.exit(1); }

// 2. history: one price per deal per flyer week (weeks start Thursday, Toronto time)
const now = new Date(Date.now() - 5 * 3600e3), thu = new Date(now); thu.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 3) % 7));
const week = thu.toISOString().slice(0, 10);
let hist = { weeks: [], items: {} };
try { hist = JSON.parse(fs.readFileSync('data/history.json', 'utf8')); } catch (e) {}
let wi = hist.weeks.indexOf(week); if (wi < 0) wi = hist.weeks.push(week) - 1;
for (const it of items) {
  const key = it.m + '|' + ctx.norm(it.n).trim(), a = hist.items[key] || (hist.items[key] = []), last = a[a.length - 1];
  if (last && last[0] === wi) last[1] = Math.min(last[1], it.p); else a.push([wi, it.p]);
}
const drop = hist.weeks.length - KEEP_WEEKS;
if (drop > 0) {
  hist.weeks = hist.weeks.slice(drop);
  for (const k of Object.keys(hist.items)) { const a = hist.items[k].filter(e => e[0] >= drop).map(e => [e[0] - drop, e[1]]); if (a.length) hist.items[k] = a; else delete hist.items[k]; }
}
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/history.json', JSON.stringify(hist));

// 3. digest for the staples: cheapest matching deals, with units from Flipp's search results
const staples = JSON.parse(fs.readFileSync('data/staples.json', 'utf8'));
const byId = new Map(items.map(i => [i.id, i]));
for (const st of staples) {
  try {
    const d = await get(API + 'items/search?locale=en-ca&postal_code=' + PCS[0] + '&q=' + encodeURIComponent(st.q));
    for (const x of d.items || []) { const it = byId.get(x.flyer_item_id || x.id); if (it) { if (x.post_price_text) it.u = x.post_price_text; if (x.pre_price_text) it.pre = x.pre_price_text; } }
  } catch (e) { console.warn(String(e)); }
}
const eff = it => { let p = it.p; const m = /^(\d+)\s*(\/|for)/i.exec(it.pre || ''); if (m && +m[1] > 1) p /= +m[1]; return /100 ?g/i.test(it.u || '') ? p * 4.536 : p; };
const unit = it => { const u = (it.u || '').trim().toLowerCase().replace(/\b(each|ea|ca)\b\.?/g, 'ea'); return u ? (/^\//.test(u) ? u : '/' + u) : ''; };
ctx.ITEMS = items;
const lines = staples.map(st => {
  const m = [...ctx.find(st.q, true)].sort((a, b) => eff(a) - eff(b)).slice(0, 3);
  return { q: st.q, max: st.max || null, hit: !!(st.max && m.length && eff(m[0]) <= st.max + 0.005), deals: m.map(it => ({ m: it.m, n: it.n, p: it.p, u: unit(it) })) };
});
const day = new Date(week + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const txt = [`Niagara grocery deals, week of ${day}: ${items.length} deals from ${seen.size} flyers.`, '']
  .concat(lines.map(l => `${l.q}: ` + (l.deals.length ? l.deals.map(d => `$${d.p.toFixed(2)}${d.u} at ${d.m} (${d.n.slice(0, 40)})`).join('; ') : 'not in any flyer this week')
    + (l.max ? (l.hit ? `  [at or under your $${l.max.toFixed(2)} buy price]` : `  [above your $${l.max.toFixed(2)} buy price]`) : '')))
  .concat(['', 'Open the app: https://mvb1610.github.io/grocery-deals/']).join('\n');
fs.writeFileSync('data/digest.json', JSON.stringify({ week, generated: new Date().toISOString(), deals: items.length, flyers: seen.size, lines }, null, 1));
fs.writeFileSync('data/digest.txt', txt + '\n');
console.log(txt);
