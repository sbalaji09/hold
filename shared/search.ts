// Supplier-history search, backed by Moss: ONE shared index for all suppliers, every query filtered
// by supplier_id (the Moss plan caps indexes per project, so one-per-supplier does not fit).
// Implementation: shared/mossSearch.ts. Tests use an in-memory fake.
import type { SourceKind, SupplierRecord } from "./contract.js";

export interface SearchHit {
  record: SupplierRecord;
  score: number; // higher = more relevant
}

export interface SupplierSearch {
  /**
   * Load the index into memory so the first query on a call adds no dead air. The index is shared,
   * so this loads once for every supplier; concurrent calls share the same load.
   */
  warm(supplier_id: string): Promise<void>;
  search(
    supplier_id: string,
    query: string,
    opts?: { topK?: number; kinds?: SourceKind[] },
  ): Promise<SearchHit[]>;
  /** Replace this supplier's records in the index (other suppliers' records are untouched). */
  index(supplier_id: string, records: SupplierRecord[]): Promise<void>;
  /** Every record in the index, to compare with Convex on startup. Optional: without it, the first snapshot is trusted. */
  list?(): Promise<SupplierRecord[]>;
}

/** The one Moss index holding every supplier's history. */
export const SUPPLIER_INDEX = "fogline-suppliers";

/** Moss document id: prefixed by supplier so one supplier's docs can be found and replaced. */
export const mossDocId = (supplier_id: string, record_id: string) => `${supplier_id}:${record_id}`;
