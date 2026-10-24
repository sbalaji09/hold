// Keeps hold's Moss memory in step with Convex. When a supplier's history changes (an email or
// bill lands, a payment goes out, a check call finishes) that supplier is re-indexed within
// seconds, so the next call's questions, the live answer lookups and the writing-style check all
// see it. On startup each supplier is compared with what Moss holds, and any that fell behind
// (or are new) are re-indexed too.
import type { SupplierRecord } from "../../shared/contract.js";
import type { SupplierSearch } from "../../shared/search.js";
import { log } from "./audio/log.js";
import type { VoiceStore } from "./store/types.js";

/** What a supplier's history looks like, to tell whether Moss already has it. */
export function fingerprint(records: SupplierRecord[]): string {
  return records
    .map((r) => `${r.id}|${r.date}|${r.text}`)
    .sort()
    .join("\n");
}

export function keepMemoryCurrent(store: VoiceStore, search: SupplierSearch, debounceMs = 2_000): () => void {
  const known = new Map<string, string>();
  const latest = new Map<string, SupplierRecord[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // What Moss holds now, per supplier. If it can't be read, the first snapshot is trusted instead.
  const indexed: Promise<Map<string, string> | null> = (search.list?.() ?? Promise.reject(new Error("no list")))
    .then((records) => {
      const bySupplier = new Map<string, SupplierRecord[]>();
      for (const r of records) bySupplier.set(r.supplier_id, [...(bySupplier.get(r.supplier_id) ?? []), r]);
      return new Map([...bySupplier].map(([sid, rs]) => [sid, fingerprint(rs)]));
    })
    .catch(() => null);

  const reindex = async (supplier_id: string) => {
    const records = latest.get(supplier_id) ?? [];
    const started = Date.now();
    // Moss answers bursts (a startup catch-up) with 429s, so back off and retry a few times.
    for (let attempt = 1; ; attempt++) {
      try {
        await search.index(supplier_id, records);
        log.info("moss memory updated", { supplier: supplier_id, records: records.length, ms: Date.now() - started });
        return;
      } catch (err) {
        if (attempt >= 4) {
          known.delete(supplier_id); // try again on the next change
          log.warn("moss memory update failed", { supplier: supplier_id, error: String(err) });
          return;
        }
        await new Promise((r) => setTimeout(r, 2_000 * 2 ** (attempt - 1)));
      }
    }
  };

  const stop = store.watchSupplierHistory((supplier_id, records) => {
    void indexed.then((inMoss) => {
      const now = fingerprint(records);
      const before = known.get(supplier_id) ?? (inMoss ? (inMoss.get(supplier_id) ?? "") : now);
      known.set(supplier_id, now);
      latest.set(supplier_id, records);
      if (before === now) return;
      clearTimeout(timers.get(supplier_id));
      timers.set(
        supplier_id,
        setTimeout(() => {
          timers.delete(supplier_id);
          void reindex(supplier_id);
        }, debounceMs),
      );
    });
  });

  return () => {
    stop();
    for (const t of timers.values()) clearTimeout(t);
  };
}
