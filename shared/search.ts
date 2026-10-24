// Supplier-history search, backed by Moss (one index per supplier).
// Implementation: shared/mossSearch.ts. Tests use an in-memory fake.
import type { SourceKind, SupplierRecord } from "./contract.js";

export interface SearchHit {
  record: SupplierRecord;
  score: number; // higher = more relevant
}

export interface SupplierSearch {
  /** Load the supplier's index into memory so the first query on a call adds no dead air. */
  warm(supplier_id: string): Promise<void>;
  search(
    supplier_id: string,
    query: string,
    opts?: { topK?: number; kinds?: SourceKind[] },
  ): Promise<SearchHit[]>;
  /** (Re)build the supplier's index from its records. */
  index(supplier_id: string, records: SupplierRecord[]): Promise<void>;
}

export const indexNameFor = (supplier_id: string) => `fogline-${supplier_id}`;
