"use client";
// A New supplier's page: what hold found about them, the background check, and Maya's (or Dev's)
// confirmation - a trusted number that didn't come from their email, plus Fogline's own facts
// about the engagement, which is what the check call asks about (convex/app/onboarding.ts).
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Amount, Button, StatusMark } from "@/components/callback";
import { BackgroundCheckPanel } from "@/components/BackgroundCheckPanel";
import { TIME_ZONE, formatPhone } from "@/components/voice/format";
import { STATUS_TO_MARK } from "@/lib/inbox";
import { PERSON_NAME } from "@/lib/playbook";
import type { BackgroundCheck, Bill, Supplier } from "@/lib/types";

type Persona = keyof typeof PERSON_NAME;
type Note = NonNullable<NonNullable<Supplier["onboarding"]>["note"]>;

const whenFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Last ten digits, so "(628) 555-0143" and "+16285550143" compare equal. */
const digits = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/** Intake writes "unknown" when the email has no invoice number it can read. */
const invoiceLabel = (b: Bill) => (b.invoiceNo === "unknown" ? "Bill with no invoice number" : `Invoice ${b.invoiceNo}`);

const FIELD = "w-full rounded-sm border border-line-control bg-surface px-2.5 py-2 text-[14px]/[20px] text-ink";

const FACTS: Array<{ key: keyof Note; label: string }> = [
  { key: "hiredFor", label: "What Fogline hired them for" },
  { key: "agreed", label: "What was agreed (price, terms)" },
  { key: "dates", label: "Dates" },
  { key: "foglineContact", label: "Who at Fogline arranged it" },
];

/** Fogline's confirmation of a new supplier, read-only. Also shown once they're Trusted. */
export function OnboardingRecord({ supplier }: { supplier: Supplier }): React.ReactElement | null {
  const o = supplier.onboarding;
  if (!o?.note) return null;
  return (
    <section className="cb-doc" aria-labelledby="onboarding-head">
      <div className="cb-doc-head">
        <span id="onboarding-head">Confirmed as a new supplier</span>
        {o.confirmedAt ? <small>{whenFmt.format(new Date(o.confirmedAt))}</small> : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 p-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <dt className="cb-caps pt-1">Trusted number</dt>
        <dd className="m-0 mb-2 font-mono text-[14px] text-ink">{supplier.trustedPhone ? formatPhone(supplier.trustedPhone) : "None on file"}</dd>
        {FACTS.map((f) => (
          <React.Fragment key={f.key}>
            <dt className="cb-caps pt-1">{f.label}</dt>
            <dd className="m-0 mb-2 text-[14px]/[20px] text-ink">{o.note![f.key] || <span className="text-ink-muted">Not given</span>}</dd>
          </React.Fragment>
        ))}
        {o.confirmedBy ? (
          <>
            <dt className="cb-caps pt-1">Confirmed by</dt>
            <dd className="m-0 font-serif text-[17px]/[24px] italic text-signatory">{PERSON_NAME[o.confirmedBy]}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function Found({ supplier, firstBill }: { supplier: Supplier; firstBill: Bill | null }): React.ReactElement {
  const emailPhones = supplier.onboarding?.emailPhones ?? [];
  return (
    <section className="cb-doc" aria-labelledby="found-head">
      <div className="cb-doc-head">
        <span id="found-head">What hold found</span>
        <small>{supplier.onboarding?.source === "email" ? "From their first bill" : "Added by hand"}</small>
      </div>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-[13px]/[20px]">
        <dt className="cb-caps pt-0.5">Name</dt>
        <dd className="m-0 text-ink">{supplier.name}</dd>
        <dt className="cb-caps pt-0.5">Contact</dt>
        <dd className="m-0 min-w-0">
          {supplier.contactName ? <span className="font-serif text-[15px] italic text-signatory">{supplier.contactName}</span> : <span className="text-ink-muted">No name in the email</span>}
          {supplier.contactEmail ? <span className="block break-all font-mono text-[12px] text-ink-muted">{supplier.contactEmail}</span> : null}
        </dd>
        <dt className="cb-caps pt-0.5">Domain</dt>
        <dd className="m-0 break-all font-mono text-[12.5px] text-ink">{supplier.domain}</dd>
        {firstBill ? (
          <>
            <dt className="cb-caps pt-0.5">First bill</dt>
            <dd className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/bills/${firstBill.key}`} className="text-ink underline underline-offset-4">
                {invoiceLabel(firstBill)}
              </Link>
              <Amount cents={firstBill.amountCents} />
              <StatusMark status={STATUS_TO_MARK[firstBill.status]} />
            </dd>
          </>
        ) : null}
      </dl>
      {emailPhones.length > 0 ? (
        <div className="border-t border-dashed border-line px-4 py-3">
          <div className="cb-caps">Numbers in their email</div>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {emailPhones.map((p) => (
              <li key={p} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-mono text-[13px] text-ink-muted line-through decoration-ink-muted">{formatPhone(p)}</span>
                <span className="font-mono text-[12px] text-ink-muted">From their email - can&rsquo;t be used to verify them</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

interface ConfirmSupplierProps {
  supplier: Supplier;
  bills: Bill[];
  lastCheck: BackgroundCheck | null;
  actor: Persona;
}

export function ConfirmSupplier({ supplier, bills, lastCheck, actor }: ConfirmSupplierProps): React.ReactElement {
  const router = useRouter();
  const confirm = useMutation(api.app.onboarding.confirmNewSupplier);
  const emailPhones = supplier.onboarding?.emailPhones ?? [];
  const fromEmail = (phone: string) => digits(phone).length === 10 && emailPhones.some((p) => digits(p) === digits(phone));
  const suggested = lastCheck?.suggestedPhone && !fromEmail(lastCheck.suggestedPhone) ? lastCheck.suggestedPhone : "";

  const [phone, setPhone] = React.useState(suggested);
  const phoneTouched = React.useRef(false);
  const [contactName, setContactName] = React.useState(supplier.contactName);
  const [note, setNote] = React.useState<Note>({ hiredFor: "", agreed: "", dates: "", foglineContact: "" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [calls, setCalls] = React.useState<number | null>(null);

  // The automatic background check usually lands after the page opens: prefill its number then,
  // unless someone has already typed one.
  React.useEffect(() => {
    if (suggested && !phoneTouched.current) setPhone(suggested);
  }, [suggested]);

  const firstBill = bills.find((b) => b.key === supplier.onboarding?.firstBillKey) ?? bills[bills.length - 1] ?? null;
  // Confirmed in the database, or just now (before the refreshed page arrives).
  const confirmed = Boolean(supplier.onboarding?.confirmedAt) || calls !== null;
  const calling = bills.filter((b) => b.status === "Calling");
  const open = bills.filter((b) => b.status !== "Paid" && b.status !== "Scheduled");
  const autoRunning = !lastCheck && supplier.onboarding?.source === "email";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await confirm({ supplierKey: supplier.key, trustedPhone: phone, contactName, note, actor });
      setCalls(res.calls);
      router.refresh();
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "hold couldn't save that just now. Try again.");
    } finally {
      setPending(false);
    }
  }

  const set = (key: keyof Note) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setNote((n) => ({ ...n, [key]: e.target.value }));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="confirm-head">
      <div className="flex flex-col items-start gap-2">
        {confirmed ? <span className="cb-caps">New · confirmed</span> : <StatusMark status="needs-you">Needs confirming</StatusMark>}
        <h2 id="confirm-head" className="cb-subject text-ink">
          {confirmed ? `${supplier.name} is confirmed` : "Confirm this new supplier"}
        </h2>
        <p className="m-0 max-w-[68ch] font-mono text-[13px]/[21px] text-ink">
          {confirmed
            ? `${supplier.name} stays New until hold reaches them on the trusted number and they confirm the bill. Then they're Trusted, and Dev approves the first payment.`
            : `Fogline has never paid ${supplier.name}. Nothing is paid until you confirm who they are and hold reaches them on a number that didn't come from their email.`}
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 min-[1101px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <Found supplier={supplier} firstBill={firstBill} />
          <BackgroundCheckPanel
            supplierKey={supplier.key}
            lastCheck={lastCheck}
            autoRunning={autoRunning}
            onUseNumber={
              confirmed
                ? undefined
                : (p) => {
                    phoneTouched.current = true;
                    setPhone(p);
                    document.getElementById("confirm-phone")?.focus();
                  }
            }
          />
        </div>

        {confirmed ? (
          <div className="flex min-w-0 flex-col gap-5">
            <section className="cb-doc p-4" aria-live="polite">
              <div className="cb-caps">The check call</div>
              {calling.length > 0 ? (
                <p className="m-0 mt-2 font-mono text-[13px]/[21px] text-ink">
                  hold is calling {supplier.name} on {formatPhone(supplier.trustedPhone)} about {calling.length} waiting bill{calling.length === 1 ? "" : "s"}.
                </p>
              ) : calls ? (
                <p className="m-0 mt-2 font-mono text-[13px]/[21px] text-ink">
                  Confirmed. hold is calling {supplier.name} about {calls} waiting bill{calls === 1 ? "" : "s"}.
                </p>
              ) : calls === 0 ? (
                <p className="m-0 mt-2 font-mono text-[13px]/[21px] text-ink">No bills were waiting, so hold didn&rsquo;t call. The next bill from {supplier.name} gets a check call.</p>
              ) : (
                <p className="m-0 mt-2 font-mono text-[13px]/[21px] text-ink">
                  {open.length > 0 ? `Where ${supplier.name}'s bills stand:` : `No open bills from ${supplier.name}.`}
                </p>
              )}
              {open.length > 0 ? (
                <ul className="m-0 mt-3 flex list-none flex-col p-0">
                  {open.map((b) => (
                    <li key={b.key} className="border-t border-line first:border-0">
                      <Link href={`/bills/${b.key}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[13px] text-ink no-underline hover:underline">
                        <span>{invoiceLabel(b)}</span>
                        <StatusMark status={STATUS_TO_MARK[b.status]} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {calling.length > 0 || calls ? (
                <div className="mt-3">
                  <Link href="/phone" className="cb-btn cb-btn-primary cb-btn-sm no-underline">
                    Open the live call
                  </Link>
                </div>
              ) : null}
            </section>
            <OnboardingRecord supplier={supplier} />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="cb-doc min-w-0" aria-labelledby="confirm-form-head" noValidate>
            <div className="cb-doc-head">
              <span id="confirm-form-head">Your confirmation</span>
              <small>Signing as {PERSON_NAME[actor]}</small>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-phone" className="cb-caps">
                  Trusted number
                </label>
                <input
                  id="confirm-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  required
                  value={phone}
                  onChange={(e) => {
                    phoneTouched.current = true;
                    setPhone(e.target.value);
                  }}
                  placeholder="(415) 555-0100"
                  aria-describedby="confirm-phone-help"
                  aria-invalid={fromEmail(phone) || undefined}
                  className={FIELD + " font-mono"}
                />
                <p id="confirm-phone-help" className={"m-0 text-[12px]/[17px] " + (fromEmail(phone) ? "text-hold" : "text-ink-muted")}>
                  {fromEmail(phone)
                    ? "That number is in their own email, so it can't verify them. Use the background check's number or one from Fogline's records."
                    : suggested && digits(phone) === digits(suggested)
                      ? "From the background check. Check it against the source before you confirm."
                      : lastCheck?.suggestedPhone && fromEmail(lastCheck.suggestedPhone)
                        ? "The number on their site is the one in their email, so it can't verify them. Use one from Fogline's own records."
                        : "From the background check or Fogline's own records, never from their email."}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-contact" className="cb-caps">
                  Contact name
                </label>
                <input id="confirm-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="off" className={FIELD} />
              </div>

              <fieldset className="m-0 flex flex-col gap-4 border-0 border-t border-dashed border-line p-0 pt-4">
                <legend className="float-left mb-1 w-full p-0">
                  <span className="text-[14px]/[20px] font-semibold text-ink">Fogline&rsquo;s facts</span>
                  <span className="mt-1 block font-mono text-[12.5px]/[19px] font-normal text-ink-muted">
                    hold asks about these on the check call; nothing on the web is secret enough to verify a new supplier.
                  </span>
                </legend>
                {FACTS.map((f) => {
                  const required = f.key === "hiredFor" || f.key === "agreed";
                  const id = `confirm-${f.key}`;
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5">
                      <label htmlFor={id} className="cb-caps">
                        {f.label}
                        {required ? "" : " · optional"}
                      </label>
                      {required ? (
                        <textarea id={id} rows={2} required value={note[f.key]} onChange={set(f.key)} className={FIELD + " resize-y"} />
                      ) : (
                        <input id={id} value={note[f.key]} onChange={set(f.key)} autoComplete="off" className={FIELD} />
                      )}
                    </div>
                  );
                })}
              </fieldset>

              {error ? (
                <p role="alert" className="m-0 font-mono text-[12.5px]/[19px] text-hold-solid">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <Button variant="primary" type="submit" icon="phone" disabled={pending}>
                  {pending ? "Confirming…" : "Confirm and call them"}
                </Button>
                <span className="text-[12px]/[17px] text-ink-muted">hold then calls them about every waiting bill.</span>
              </div>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
