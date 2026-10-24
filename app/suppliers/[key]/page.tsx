import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount, AccountLine, Cite, StatusMark } from "@/components/callback";
import { BackgroundCheckPanel } from "@/components/BackgroundCheckPanel";
import { ConfirmSupplier, OnboardingRecord } from "@/components/ConfirmSupplier";
import { getPersona } from "@/lib/persona";
import { capital, languageName } from "@/lib/company";
import { LearnedRules } from "@/components/LearnedRules";
import { getCompany, getSupplier, listBankAccountsForSupplier, listBillsForSupplier, listCallsForSupplier, listChecksForSupplier } from "@/lib/data";
import { STATUS_TO_MARK, shortDate } from "@/lib/inbox";

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  if (d.length < 10) return e164 || "No number on file";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const STATUS_LABEL = { new: "New", trusted: "Trusted", under_review: "Under review" } as const;

function formatDate(iso: string): string {
  if (!iso) return "Never checked";
  // A bare "2026-10-24" parses as UTC midnight; read it in UTC so it isn't shown as the day before.
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
}

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<React.ReactElement> {
  const { key } = await params;
  const supplier = await getSupplier(key);
  if (!supplier) notFound();

  const [bankAccounts, bills, calls, checks, persona] = await Promise.all([
    listBankAccountsForSupplier(key),
    listBillsForSupplier(key),
    listCallsForSupplier(key),
    listChecksForSupplier(key),
    getPersona(),
  ]);
  const co = await getCompany();
  const isNew = supplier.status === "new";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-sans text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-muted">
          <Link href="/suppliers">{capital(co.payee).many}</Link> / {STATUS_LABEL[supplier.status ?? "trusted"]}
        </div>
        <h1 className="cb-display break-words text-ink">{supplier.name}</h1>
        <p className="mt-1 break-all font-mono text-[12px] text-ink-muted">{supplier.domain}</p>
      </div>

      {isNew ? (
        <ConfirmSupplier supplier={supplier} bills={bills} lastCheck={checks[0] ?? null} actor={persona} />
      ) : (
      <div className="grid gap-5 md:grid-cols-2">
        <article className="cb-doc p-4">
          <div className="cb-caps mb-2">Trusted phone</div>
          <p className="font-mono text-[18px] text-ink">{formatPhone(supplier.trustedPhone)}</p>
          <p className="mt-2 text-[13px] text-ink-muted">Last checked {formatDate(supplier.phoneLastCheckedAt)}</p>
          {supplier.language && supplier.language !== "en" ? (
            <p className="mt-1 font-mono text-[12px] text-ink">Check calls in {languageName(supplier.language)}.</p>
          ) : null}
          {supplier.phoneMenu ? (
            <p className="mt-1 font-mono text-[12px] text-ink">
              Phone menu: hold presses {supplier.phoneMenu.replace(/w/g, "").split("").join(", then ")} to reach them.
            </p>
          ) : null}
        </article>

        <BackgroundCheckPanel supplierKey={key} lastCheck={checks[0] ?? null} />
      </div>
      )}

      {isNew ? null : <OnboardingRecord supplier={supplier} />}

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
                <Cite>{b.verifiedBy === "onboarding" ? "Verified at onboarding" : `Verified by call + ${co.dev.name}`}</Cite>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="cb-doc">
        <div className="cb-doc-head">
          <span>Past {co.bill.many}</span>
        </div>
        <div className="flex flex-col">
          {bills.length === 0 ? (
            <p className="p-4 text-[13px] text-ink-muted">No {co.bill.many} for this {co.payee.one} yet.</p>
          ) : (
            bills.map((bill) => (
              <Link
                key={bill.key}
                href={`/bills/${bill.key}`}
                className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-ink no-underline first:border-0 hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{bill.invoiceNo === "unknown" ? `${capital(co.bill).one} with no number` : `${capital({ one: co.record, many: co.record }).one} ${bill.invoiceNo}`}</span>
                <StatusMark status={STATUS_TO_MARK[bill.status]} />
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
            <p className="p-4 text-[13px] text-ink-muted">hold hasn&rsquo;t called this {co.payee.one} yet.</p>
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

      <LearnedRules supplierKey={key} />
    </div>
  );
}
