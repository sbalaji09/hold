// SupplierSearch backed by Moss (@inferedge/moss), one index per supplier.
// Runs in Node (voice server, scripts). Queries run in memory after warm() downloads the index;
// metadata filters only work on a loaded index, so search() always warms first.
import { MossClient, type DocumentInfo, type MetadataFilter } from "@inferedge/moss";
import type { SourceKind, SupplierRecord } from "./contract.js";
import { indexNameFor, type SearchHit, type SupplierSearch } from "./search.js";

const KINDS: readonly SourceKind[] = ["invoice", "email", "call", "payment"];

/** Metadata stored on each Moss document so a hit maps back to a SupplierRecord. Moss metadata values are strings. */
export function toMossDoc(r: SupplierRecord): DocumentInfo {
  const metadata: Record<string, string> = {
    id: r.id,
    supplier_id: r.supplier_id,
    kind: r.kind,
    ref: r.ref,
    date: r.date,
  };
  if (r.amount_cents !== undefined) metadata.amount_cents = String(r.amount_cents);
  return { id: r.id, text: r.text, metadata };
}

export function fromMossDoc(doc: DocumentInfo, supplier_id: string): SupplierRecord | null {
  const m = doc.metadata ?? {};
  const kind = m.kind as SourceKind | undefined;
  if (!kind || !KINDS.includes(kind)) return null;
  const r: SupplierRecord = {
    id: m.id ?? doc.id,
    supplier_id: m.supplier_id ?? supplier_id,
    kind,
    ref: m.ref ?? "",
    date: m.date ?? "",
    text: doc.text,
  };
  const cents = m.amount_cents === undefined ? NaN : Number(m.amount_cents);
  if (Number.isFinite(cents)) r.amount_cents = cents;
  return r;
}

function kindFilter(kinds: SourceKind[]): MetadataFilter {
  return kinds.length === 1
    ? { field: "kind", condition: { $eq: kinds[0]! } }
    : { field: "kind", condition: { $in: kinds } };
}

export class MossSearch implements SupplierSearch {
  private readonly client: MossClient;
  /** Index name -> load in flight or done. Dropped on failure so the next call retries. */
  private readonly loaded = new Map<string, Promise<void>>();

  constructor(projectId: string, projectKey: string) {
    this.client = new MossClient(projectId, projectKey);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): MossSearch {
    const id = env.MOSS_PROJECT_ID;
    const key = env.MOSS_PROJECT_KEY;
    if (!id || !key) throw new Error("MOSS_PROJECT_ID and MOSS_PROJECT_KEY must be set");
    return new MossSearch(id, key);
  }

  warm(supplier_id: string): Promise<void> {
    const name = indexNameFor(supplier_id);
    let p = this.loaded.get(name);
    if (!p) {
      p = this.client.loadIndex(name).then(() => undefined);
      p.catch(() => this.loaded.delete(name));
      this.loaded.set(name, p);
    }
    return p;
  }

  async search(
    supplier_id: string,
    query: string,
    opts: { topK?: number; kinds?: SourceKind[] } = {},
  ): Promise<SearchHit[]> {
    await this.warm(supplier_id);
    const kinds = opts.kinds?.length ? opts.kinds : undefined;
    const res = await this.client.query(indexNameFor(supplier_id), query, {
      topK: opts.topK ?? 5,
      ...(kinds ? { filter: kindFilter(kinds) } : {}),
    });
    const hits: SearchHit[] = [];
    for (const doc of res.docs) {
      const record = fromMossDoc(doc, supplier_id);
      // Belt and braces: the filter already applied, but never return a kind the caller excluded.
      if (record && (!kinds || kinds.includes(record.kind))) hits.push({ record, score: doc.score });
    }
    return hits;
  }

  /** Create-or-replace the supplier's index. An empty record list just removes the index. */
  async index(supplier_id: string, records: SupplierRecord[]): Promise<void> {
    const name = indexNameFor(supplier_id);
    const existing = await this.client.listIndexes();
    if (existing.some((i) => i.name === name)) await this.client.deleteIndex(name);
    const wasLoaded = this.loaded.delete(name);
    if (records.length === 0) return;
    // ponytail: delete then create leaves a short window with no index. Switch to addDocs/deleteDocs diffs if reindexing during live calls matters.
    await this.client.createIndex(name, records.map(toMossDoc));
    if (wasLoaded) await this.warm(supplier_id);
  }
}
