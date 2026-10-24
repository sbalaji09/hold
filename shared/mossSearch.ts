// SupplierSearch backed by Moss (@inferedge/moss): one shared index for every supplier.
// Runs in Node (voice server, scripts). Queries run in memory after warm() downloads the index;
// metadata filters only work on a loaded index, so search() always warms first and always
// filters by supplier_id, so one supplier's call can never see another supplier's records.
import { MossClient, type DocumentInfo, type MetadataFilter } from "@inferedge/moss";
import type { SourceKind, SupplierRecord } from "./contract.js";
import { mossDocId, SUPPLIER_INDEX, type SearchHit, type SupplierSearch } from "./search.js";

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
  return { id: mossDocId(r.supplier_id, r.id), text: r.text, metadata };
}

/** Null for a document that isn't a valid supplier record. */
export function fromMossDoc(doc: DocumentInfo): SupplierRecord | null {
  const m = doc.metadata ?? {};
  const kind = m.kind as SourceKind | undefined;
  if (!kind || !KINDS.includes(kind) || !m.supplier_id || !m.id) return null;
  const r: SupplierRecord = {
    id: m.id,
    supplier_id: m.supplier_id,
    kind,
    ref: m.ref ?? "",
    date: m.date ?? "",
    text: doc.text,
  };
  const cents = m.amount_cents === undefined ? NaN : Number(m.amount_cents);
  if (Number.isFinite(cents)) r.amount_cents = cents;
  return r;
}

export function searchFilter(supplier_id: string, kinds?: SourceKind[]): MetadataFilter {
  const bySupplier: MetadataFilter = { field: "supplier_id", condition: { $eq: supplier_id } };
  if (!kinds?.length) return bySupplier;
  const byKind: MetadataFilter =
    kinds.length === 1
      ? { field: "kind", condition: { $eq: kinds[0]! } }
      : { field: "kind", condition: { $in: kinds } };
  return { $and: [bySupplier, byKind] };
}

export class MossSearch implements SupplierSearch {
  private readonly client: MossClient;
  /** The shared index's load: in flight or done. Dropped on failure so the next call retries. */
  private loading: Promise<void> | null = null;
  /** Index writes run one at a time, so two replaces can't race createIndex. */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    projectId: string,
    projectKey: string,
    private readonly indexName: string = SUPPLIER_INDEX,
  ) {
    this.client = new MossClient(projectId, projectKey);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): MossSearch {
    const id = env.MOSS_PROJECT_ID;
    const key = env.MOSS_PROJECT_KEY;
    if (!id || !key) throw new Error("MOSS_PROJECT_ID and MOSS_PROJECT_KEY must be set");
    return new MossSearch(id, key);
  }

  /** The supplier id is unused: there is one index, loaded once for everyone. */
  warm(_supplier_id?: string): Promise<void> {
    if (!this.loading) {
      const p = this.client.loadIndex(this.indexName).then(() => undefined);
      p.catch(() => {
        if (this.loading === p) this.loading = null;
      });
      this.loading = p;
    }
    return this.loading;
  }

  async search(
    supplier_id: string,
    query: string,
    opts: { topK?: number; kinds?: SourceKind[] } = {},
  ): Promise<SearchHit[]> {
    await this.warm();
    const kinds = opts.kinds?.length ? opts.kinds : undefined;
    const res = await this.client.query(this.indexName, query, {
      topK: opts.topK ?? 5,
      filter: searchFilter(supplier_id, kinds),
    });
    const hits: SearchHit[] = [];
    for (const doc of res.docs) {
      const record = fromMossDoc(doc);
      // Belt and braces: the filter already applied, but never leak another supplier or kind.
      if (record && record.supplier_id === supplier_id && (!kinds || kinds.includes(record.kind))) {
        hits.push({ record, score: doc.score });
      }
    }
    return hits;
  }

  /** Replace one supplier's documents; other suppliers' documents are untouched. */
  index(supplier_id: string, records: SupplierRecord[]): Promise<void> {
    const docs = records.filter((r) => r.supplier_id === supplier_id).map(toMossDoc);
    if (docs.length !== records.length) throw new Error(`index(${supplier_id}): records from another supplier`);
    return this.write(async () => {
      if (!(await this.exists())) {
        if (docs.length) await this.client.createIndex(this.indexName, docs);
        return;
      }
      const prefix = mossDocId(supplier_id, "");
      const keep = new Set(docs.map((d) => d.id));
      const stale = (await this.client.getDocs(this.indexName))
        .map((d) => d.id)
        .filter((id) => id.startsWith(prefix) && !keep.has(id));
      if (stale.length) await this.client.deleteDocs(this.indexName, stale);
      if (docs.length) await this.client.addDocs(this.indexName, docs, { upsert: true });
    });
  }

  /**
   * Rebuild the whole shared index from every supplier's records in one Moss job.
   * ponytail: delete-then-create leaves a short window with no index; use index() per supplier
   * for changes while calls are live.
   */
  indexAll(records: SupplierRecord[]): Promise<void> {
    const docs = records.map(toMossDoc);
    return this.write(async () => {
      if (await this.exists()) await this.client.deleteIndex(this.indexName);
      if (docs.length) await this.client.createIndex(this.indexName, docs);
    });
  }

  private async exists(): Promise<boolean> {
    return (await this.client.listIndexes()).some((i) => i.name === this.indexName);
  }

  /** Serialises writes and reloads the in-memory copy afterwards if it was loaded. */
  private write(fn: () => Promise<void>): Promise<void> {
    const run = this.writes.then(async () => {
      await fn();
      if (this.loading) {
        this.loading = null;
        await this.warm();
      }
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}
