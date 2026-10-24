import * as React from "react";
import Link from "next/link";
import { listSupplierSummaries } from "@/lib/data";
import { AddSupplierForm } from "@/components/AddSupplierForm";

function shortDate(iso: string): string {
  if (!iso) return "Never checked";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}


const STATUS_LABEL: Record<"new" | "trusted" | "under_review", string> = {
  new: "New",
  trusted: "Trusted",
  under_review: "Under review",
};

export default async function SuppliersPage(): Promise<React.ReactElement> {
  const suppliers = await listSupplierSummaries();

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="cb-display text-ink">Suppliers</h1>
          <p className="font-mono text-[12px] text-ink-muted">{suppliers.length} on file</p>
        </div>
        <AddSupplierForm />
      </div>

      <div className="cb-ledger">
        <div className="grid grid-cols-[minmax(160px,220px)_1fr_120px_160px_90px] items-center gap-3 border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
          <span>Supplier</span>
          <span>Domain</span>
          <span>Status</span>
          <span>Last checked</span>
          <span>Open</span>
        </div>
        {suppliers.length === 0 ? (
          <div className="p-6 text-[13px] text-ink-muted">No suppliers yet. Add Fogline's first one above.</div>
        ) : (
          suppliers.map((s) => (
            <div
              key={s.key}
              className="grid grid-cols-[minmax(160px,220px)_1fr_120px_160px_90px] items-center gap-3 border-t border-line px-4 py-2.5 text-ink"
            >
              <Link href={`/suppliers/${s.key}`} className="truncate text-[13px] font-medium text-ink no-underline hover:underline">
                {s.name}
              </Link>
              <span className="font-mono text-[12px] text-ink-muted">{s.domain}</span>
              <span className="cb-caps">{STATUS_LABEL[s.status ?? "trusted"]}</span>
              <span className="font-mono text-[12px] text-ink-muted">{shortDate(s.phoneLastCheckedAt)}</span>
              {s.openItems > 0 ? (
                <Link href={`/approvals`} className="font-mono text-[12px] text-ink no-underline hover:underline">
                  {s.openItems} open
                </Link>
              ) : (
                <span className="font-mono text-[12px] text-ink-muted">0 open</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
