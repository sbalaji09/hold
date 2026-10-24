import * as React from "react";
import Link from "next/link";
import { getCompany, listBills, listSupplierSummaries } from "@/lib/data";
import { capital } from "@/lib/company";
import { buildSupplierGraph } from "@/lib/supplierGraph";
import { StatusMark } from "@/components/callback";
import { AddSupplierForm } from "@/components/AddSupplierForm";
import { SupplierGraph } from "@/components/SupplierGraph";

function shortDate(iso: string): string {
  if (!iso) return "Never checked";
  // A bare "2026-10-24" parses as UTC midnight; read it in UTC so it isn't shown as the day before.
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
}


const STATUS_LABEL: Record<"new" | "trusted", string> = {
  new: "New",
  trusted: "Trusted",
};

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}): Promise<React.ReactElement> {
  const graphView = (await searchParams).view === "graph";
  const [suppliers, bills, co] = await Promise.all([listSupplierSummaries(), graphView ? listBills() : [], getCompany()]);
  const Payee = capital(co.payee);
  // New suppliers nobody has confirmed yet: your turn, so they lead the list.
  const needsConfirming = (s: (typeof suppliers)[number]) => s.status === "new" && !s.onboarding?.confirmedAt;
  const awaiting = suppliers.filter(needsConfirming).length;
  const rows = [...suppliers].sort((a, b) => Number(needsConfirming(b)) - Number(needsConfirming(a)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="cb-display text-ink">{Payee.many}</h1>
          <p className="font-mono text-[12px] text-ink-muted">
            {suppliers.length} on file
            {awaiting > 0 ? (
              <>
                {" · "}
                <Link href={`/suppliers/${rows[0]!.key}`} className="text-ink underline underline-offset-4">
                  {awaiting} new {awaiting === 1 ? `${co.payee.one} needs` : `${co.payee.many} need`} confirming
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <AddSupplierForm />
      </div>

      <nav className="pt-filters" aria-label={`Show ${co.payee.many} as`}>
        {[
          { label: "List", href: "/suppliers", on: !graphView },
          { label: "Graph", href: "/suppliers?view=graph", on: graphView },
        ].map((v) => (
          <Link key={v.label} href={v.href} aria-current={v.on ? "true" : undefined} className={"pt-filter" + (v.on ? " on" : "")}>
            {v.label}
          </Link>
        ))}
      </nav>

      {graphView ? (
        <SupplierGraph graph={buildSupplierGraph(suppliers, bills, co)} />
      ) : (
        <div className="pt-scroll"><div className="cb-ledger min-w-[720px]">
          <div className="grid grid-cols-[minmax(160px,220px)_1fr_150px_130px_90px] items-center gap-3 border-b-[1.5px] border-ink px-4 py-2 font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
            <span>{Payee.one}</span>
            <span>Domain</span>
            <span>Status</span>
            <span>Last checked</span>
            <span>Open</span>
          </div>
          {suppliers.length === 0 ? (
            <div className="p-6 text-[13px] text-ink-muted">No {co.payee.many} yet. Add {co.owner} first one above.</div>
          ) : (
            rows.map((s) => (
              <div
                key={s.key}
                className="grid grid-cols-[minmax(160px,220px)_1fr_150px_130px_90px] items-center gap-3 border-t border-line px-4 py-2.5 text-ink"
              >
                <Link href={`/suppliers/${s.key}`} className="truncate text-[13px] font-medium text-ink no-underline hover:underline">
                  {s.name}
                </Link>
                <span className="truncate font-mono text-[12px] text-ink-muted">{s.domain}</span>
                <span>
                  {needsConfirming(s) ? (
                    <StatusMark status="needs-you">Needs confirming</StatusMark>
                  ) : (
                    <span className="cb-caps">{STATUS_LABEL[s.status ?? "trusted"]}</span>
                  )}
                </span>
                <span className="font-mono text-[12px] text-ink-muted">{shortDate(s.phoneLastCheckedAt)}</span>
                {needsConfirming(s) ? (
                  <Link href={`/suppliers/${s.key}`} className="font-mono text-[12px] text-ink underline underline-offset-4">
                    Confirm
                  </Link>
                ) : s.openItems > 0 ? (
                  <Link href={`/approvals`} className="font-mono text-[12px] text-ink no-underline hover:underline">
                    {s.openItems} open
                  </Link>
                ) : (
                  <span className="font-mono text-[12px] text-ink-muted">0 open</span>
                )}
              </div>
            ))
          )}
        </div></div>
      )}
    </div>
  );
}
