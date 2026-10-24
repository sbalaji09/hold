// Rebuilds the shared Moss index (SUPPLIER_INDEX) from every supplier's records in Convex.
// Usage: npx tsx --env-file=.env scripts/mossIndex.ts                 (all suppliers, one Moss job)
//        npx tsx --env-file=.env scripts/mossIndex.ts sup_stage ...   (replace just those suppliers)
// Needs CONVEX_URL, VOICE_SERVER_SECRET, MOSS_PROJECT_ID, MOSS_PROJECT_KEY.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { SupplierRecord } from "../shared/contract.js";
import { MossSearch } from "../shared/mossSearch.js";
import { SUPPLIER_INDEX } from "../shared/search.js";

const url = process.env.CONVEX_URL;
const secret = process.env.VOICE_SERVER_SECRET;
if (!url || !secret) throw new Error("CONVEX_URL and VOICE_SERVER_SECRET must be set");

const convex = new ConvexHttpClient(url);
const moss = MossSearch.fromEnv();
const wanted = process.argv.slice(2);
const profiles = await convex.query(api.voice.server.listSupplierProfiles, { secret });
const missing = wanted.filter((id) => !profiles.some((p) => p.supplier_id === id));
if (missing.length) throw new Error(`Unknown supplier_id(s): ${missing.join(", ")}`);
const targets = wanted.length ? profiles.filter((p) => wanted.includes(p.supplier_id)) : profiles;

const bySupplier = new Map<string, SupplierRecord[]>();
for (const p of targets) {
  bySupplier.set(p.supplier_id, await convex.query(api.voice.server.getSupplierRecords, { secret, supplier_id: p.supplier_id }));
}

// Moss answers bursts and its plan's index cap with a bare 429, so retry with backoff, then explain.
async function withRetry(fn: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) {
        if (String(err).includes("429")) {
          console.error("Persistent 429s usually mean the Moss plan's index limit is reached (free plan: 3 per project).");
        }
        throw err;
      }
      const wait = 5_000 * 2 ** (attempt - 1);
      console.warn(`${String(err).slice(0, 120)}; retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const started = Date.now();
if (wanted.length) {
  for (const [supplier_id, records] of bySupplier) {
    await withRetry(() => moss.index(supplier_id, records));
    console.log(`${SUPPLIER_INDEX}: replaced ${supplier_id} (${records.length} records)`);
  }
} else {
  const all = [...bySupplier.values()].flat();
  await withRetry(() => moss.indexAll(all));
  console.log(`${SUPPLIER_INDEX}: ${all.length} records from ${bySupplier.size} suppliers`);
}
console.log(`done in ${Date.now() - started} ms`);
