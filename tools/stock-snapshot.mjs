// Stock snapshot for Dan's order-form generator.
// READ-ONLY: only ever GETs from Firestore. Writes one local file,
// stock_snapshot.csv, which the workflow publishes to the stock-snapshot branch.
//
// CSV columns: barcode,location,qty_on_hand,min_stock,updated_at
//  - one row per item per configured location (zeros included)
//  - min_stock repeated on every row; order-on-demand items get 0
//  - test-mode stock (testLocations) and test items are ignored
//  - items with no barcode are skipped; duplicate barcodes are summed
import { readFileSync, writeFileSync } from 'node:fs';
 
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const pick = (k) => (cfg.match(new RegExp(k + "\\s*:\\s*['\"]([^'\"]+)['\"]")) || [])[1];
const API_KEY = process.env.FIREBASE_API_KEY || pick('apiKey');
const PROJECT = process.env.FIREBASE_PROJECT_ID || pick('projectId');
if (!API_KEY || !PROJECT) { console.error('Could not read apiKey/projectId from config.js'); process.exit(1); }
 
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DEFAULT_LOCATIONS = ['Yard', "Luke's Van", "Josh's Van"];
 
async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url.replace(API_KEY, '***')} → ${res.status} ${await res.text()}`);
  return res.json();
}
// Firestore REST values → plain JS
function val(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('timestampValue' in v) return v.timestampValue;
  return undefined;
}
const fields = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, x]) => [k, val(x)]));
 
export async function buildSnapshot(now = new Date()) {
  let locations = DEFAULT_LOCATIONS;
  try {
    const meta = fields(await get(`${BASE}/meta/locations?key=${API_KEY}`));
    if (Array.isArray(meta.list) && meta.list.length) locations = meta.list;
  } catch (e) { console.warn('meta/locations not readable, using defaults:', e.message); }
 
  const items = [];
  let pageToken = '';
  do {
    const page = await get(`${BASE}/items?pageSize=300&key=${API_KEY}${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
    (page.documents || []).forEach(d => items.push(fields(d)));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
 
  const byBarcode = new Map();
  let skipped = 0;
  for (const it of items) {
    if (it.isTestData) continue;
    const bc = String(it.barcode || '').trim();
    if (!bc) { skipped++; continue; }
    const row = byBarcode.get(bc) || { qty: Object.fromEntries(locations.map(l => [l, 0])), min: 0 };
    const locs = it.locations || {}; // real stock only — testLocations deliberately not read
    for (const l of locations) row.qty[l] += Number(locs[l]) || 0;
    if (!it.orderOnDemand) row.min = Math.max(row.min, Number(it.min_qty) || 0);
    byBarcode.set(bc, row);
  }
 
  const esc = (s) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const stamp = now.toISOString();
  const lines = ['barcode,location,qty_on_hand,min_stock,updated_at'];
  [...byBarcode.keys()].sort().forEach(bc => {
    const r = byBarcode.get(bc);
    locations.forEach(l => lines.push([bc, l, r.qty[l], r.min, stamp].map(esc).join(',')));
  });
  return { csv: lines.join('\n') + '\n', stats: { items: items.length, barcodes: byBarcode.size, skipped, locations } };
}
 
if (import.meta.url === `file://${process.argv[1]}`) {
  const { csv, stats } = await buildSnapshot();
  writeFileSync('stock_snapshot.csv', csv);
  console.log(`Snapshot written: ${stats.barcodes} barcodes × ${stats.locations.length} locations from ${stats.items} items (${stats.skipped} without a barcode skipped).`);
}
