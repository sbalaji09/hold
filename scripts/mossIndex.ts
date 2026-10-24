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

for (const p of targets) {
  const records = await convex.query(api.voice.server.getSupplierRecords, { secret, supplier_id: p.supplier_id });
  const started = Date.now();
  await moss.index(p.supplier_id, records);
  console.log(`${indexNameFor(p.supplier_id)}: ${records.length} records (${Date.now() - started} ms)`);
}
