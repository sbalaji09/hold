import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount, AccountLine, Button, Cite } from "@/components/callback";
import { getSupplier, listBankAccountsForSupplier, listBillsForSupplier, listCallsForSupplier } from "@/lib/data";
import { STATUS_TO_MARK, shortDate } from "@/lib/inbox";

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  if (d.length < 10) return e164 || "No number on file";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatDate(iso: string): string {
  if (!iso) return "Never checked";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<React.ReactElement> {
  const { key } = await params;
  const supplier = await getSupplier(key);
  if (!supplier) notFound();

  const [bankAccounts, bills, calls] = await Promise.all([
    listBankAccountsForSupplier(key),
    listBillsForSupplier(key),
    listCallsForSupplier(key),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="cb-display text-ink">{supplier.name}</h1>
        <p className="mt-1 font-mono text-[12px] text-ink-muted">{supplier.domain}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <article className="cb-doc p-4">
          <div className="cb-caps mb-2">Trusted phone</div>
          <p className="font-mono text-[18px] text-ink">{formatPhone(supplier.trustedPhone)}</p>
          <p className="mt-2 text-[13px] text-ink-muted">Last checked {formatDate(supplier.phoneLastCheckedAt)}</p>
        </article>

        <article className="cb-doc p-4">
          <div className="cb-doc-head -mx-4 -mt-4 mb-3">
            <span>Background check</span>
          </div>
          <p className="text-[13px] text-ink-muted">No background check run.</p>
          <div className="mt-3">
            <Button locked="Background check arrives with the Apify verifier">Run background check</Button>
          </div>
        </article>
      </div>

      <section className="cb-doc">
        <div className="cb-doc-head">
          <span>Bank details</span>
        </div>
        <div className="flex flex-col gap-3 p-4">
          {bankAccounts.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No bank accounts on file.</p>
          ) : (
            bankAccounts.map((b) => (
              <div key={b.key} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                <AccountLine
                  bank={b.bank}
                  routing={b.routingLast4}
                  last4={b.last4}
                  state={b.status === "active" ? "verified" : "new"}
                  note={`${b.status === "active" ? "Active" : "Retired"} \u00b7 added ${shortDate(b.addedAt)}`}
                />
                <Cite>{b.verifiedBy === "onboarding" ? "Verified at onboarding" : "Verified by call + Dev"}</Cite>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="cb-doc">
        <div className="cb-doc-head">
          <span>Past bills</span>
        </div>
        <div className="flex flex-col">
          {bills.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-muted">No bills from this supplier yet.</p>
          ) : (
            bills.map((bill) => (
              <Link
                key={bill.key}
                href={`/bills/${bill.key}`}
                className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-ink no-underline first:border-0 hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">Invoice {bill.invoiceNo}</span>
                <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">{STATUS_TO_MARK[bill.status]}</span>
                <Amount cents={bill.amountCents} />
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="cb-doc">
        <div className="cb-doc-head">
          <span>Past calls</span>
        </div>
        <div className="flex flex-col">
          {calls.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-muted">Callback hasn't called this supplier yet.</p>
          ) : (
            calls.map((call) =>
              call.key ? (
                <Link
                  key={call.key}
                  href={`/calls/${encodeURIComponent(call.key)}`}
                  className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-ink no-underline first:border-0 hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{call.summary}</span>
                  <span className="font-mono text-[11px] uppercase tracking-wide text-ink-muted">{call.outcome.replace("_", " ")}</span>
                  <span className="font-mono text-[12px] text-ink-muted">{shortDate(call.startedAt)}</span>
                </Link>
              ) : null,
            )
          )}
        </div>
      </section>
    </div>
  );
}
