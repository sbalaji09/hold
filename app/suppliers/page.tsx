import * as React from "react";
import Link from "next/link";
import { listSuppliers } from "@/lib/data";
import { AddSupplierForm } from "@/components/AddSupplierForm";

function shortDate(iso: string): string {
  if (!iso) return "Never checked";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  if (d.length < 10) return e164 || "No number on file";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default async function SuppliersPage(): Promise<React.ReactElement> {
  const suppliers = await listSuppliers();

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
        <div className="grid grid-cols-[minmax(160px,220px)_1fr_160px_160px] items-center gap-3 border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
          <span>Supplier</span>
          <span>Domain</span>
          <span>Trusted phone</span>
          <span>Last checked</span>
        </div>
        {suppliers.length === 0 ? (
          <div className="p-6 text-[13px] text-ink-muted">No suppliers yet. Add Fogline's first one above.</div>
        ) : (
          suppliers.map((s) => (
            <Link
              key={s.key}
              href={`/suppliers/${s.key}`}
              className="grid grid-cols-[minmax(160px,220px)_1fr_160px_160px] items-center gap-3 border-t border-line px-4 py-2.5 text-ink no-underline hover:bg-surface-hover"
            >
              <span className="text-[13px] font-medium">{s.name}</span>
              <span className="font-mono text-[12px] text-ink-muted">{s.domain}</span>
              <span className="font-mono text-[13px]">{formatPhone(s.trustedPhone)}</span>
              <span className="font-mono text-[12px] text-ink-muted">{shortDate(s.phoneLastCheckedAt)}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
