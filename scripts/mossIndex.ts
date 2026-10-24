// (Re)builds each supplier's Moss index from the supplier data in Convex.
// Usage: npx tsx --env-file=.env scripts/mossIndex.ts [supplier_id ...]
// Needs CONVEX_URL, VOICE_SERVER_SECRET, MOSS_PROJECT_ID, MOSS_PROJECT_KEY.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { MossSearch } from "../shared/mossSearch.js";
import { indexNameFor } from "../shared/search.js";

const url = process.env.CONVEX_URL;
const secret = process.env.VOICE_SERVER_SECRET;
if (!url || !secret) throw new Error("CONVEX_URL and VOICE_SERVER_SECRET must be set");

const convex = new ConvexHttpClient(url);
const moss = MossSearch.fromEnv();
const wanted = process.argv.slice(2);
const profiles = await convex.query(api.voice.server.listSupplierProfiles, { secret });
const targets = wanted.length ? profiles.filter((p) => wanted.includes(p.supplier_id)) : profiles;
const missing = wanted.filter((id) => !profiles.some((p) => p.supplier_id === id));
if (missing.length) throw new Error(`Unknown supplier_id(s): ${missing.join(", ")}`);

// Moss rate-limits index builds (HTTP 429), so retry with backoff and space suppliers out.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry(label: string, fn: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 5) throw err;
      const wait = 5_000 * 2 ** (attempt - 1);
      console.warn(`${label}: ${String(err).slice(0, 120)}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

const failed: string[] = [];
for (const p of targets) {
  const records = await convex.query(api.voice.server.getSupplierRecords, { secret, supplier_id: p.supplier_id });
  const name = indexNameFor(p.supplier_id);
  const started = Date.now();
  try {
    await withRetry(name, () => moss.index(p.supplier_id, records));
    console.log(`${name}: ${records.length} records (${Date.now() - started} ms)`);
  } catch (err) {
    failed.push(p.supplier_id);
    console.error(`${name}: FAILED: ${String(err).slice(0, 200)}`);
  }
  await sleep(2_000);
}
if (failed.length) {
  console.error(`Not indexed: ${failed.join(", ")}. Re-run with those ids.`);
  console.error("Persistent 429s usually mean the Moss plan's index limit is reached (free plan: 3 per project).");
  process.exit(1);
}
