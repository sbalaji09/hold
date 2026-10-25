// Impact page: a fixed month of Fogline bills (data/impact-set.json), run through the same
// runChecks/decide hold uses on real bills, computed on every render — pure and fast enough
// that there's no "Run" button or stored result. Scams are planted ahead of time (not a live
// Claude call), so judges see the same numbers every time. See product-brief.md.
import impactSet from "../data/impact-set.json";
import { decide, runChecks, type RunChecksInput } from "../convex/app/checks";

const MINUTES_PER_MANUAL_CHECK = 6;

interface ImpactRow extends RunChecksInput {
  key: string;
  invoiceNo: string;
  isScam: boolean;
  scamKind: string | null;
  note: string | null;
}

export interface WhyRow {
  title: string;
  detail: string;
}

export interface ImpactStats {
  invoicesReviewed: number;
  scamsInSet: number;
  scamsCaught: number;
  moneyHeldBackCents: number;
  moneyLostWithoutHoldCents: number;
  falsePositives: number;
  falsePositiveNotes: string[];
  phoneCallsPlaced: number;
  staffMinutesSaved: number;
  minutesPerManualCheck: number;
  why: WhyRow[];
}

const rows = impactSet as ImpactRow[];

/** Honest numbers for the Impact page: every bill in the fixed set run through hold's real
 * checks right now. "Caught" = hold's decision isn't a flat pay; "false positive" = an ordinary
 * bill hold's checks flag for a call even though nothing was wrong. */
export function getImpactStats(): ImpactStats {
  let scamsCaught = 0;
  let moneyHeldBackCents = 0;
  let moneyLostWithoutHoldCents = 0;
  let falsePositives = 0;
  let phoneCallsPlaced = 0;
  const falsePositiveNotes: string[] = [];

  for (const row of rows) {
    const checks = runChecks(row);
    const decision = decide(checks, row.amountCents);
    const flagged = decision === "call";
    if (flagged) phoneCallsPlaced++;
    if (row.isScam) {
      moneyLostWithoutHoldCents += row.amountCents;
      if (flagged) {
        scamsCaught++;
        moneyHeldBackCents += row.amountCents;
      }
    } else if (flagged) {
      falsePositives++;
      if (row.note) falsePositiveNotes.push(row.note);
    }
  }

  const scamRows = rows.filter((r) => r.isScam);
  const why: WhyRow[] = [
    {
      title: "The domain is one letter off",
      detail: `${scamRows.find((r) => r.scamKind === "look-alike domain + new bank account")?.supplier.name ?? "A supplier"}'s real domain is ggtrussdeck.com; the scam email came from gg-trussdeck.com — the kind of difference a tired eye skims past in an inbox of 150 emails.`,
    },
    {
      title: "It reads exactly like the last 14 invoices",
      detail: "The duplicate-invoice scam reuses a real invoice number and copies the supplier's usual tone. Nothing about the email itself looks wrong — only the bank account changed.",
    },
    {
      title: "A bank change arrives with a plausible reason",
      detail: "\"We were acquired,\" \"we switched banks this quarter\" — real suppliers say this too. A person can't tell a genuine change from a scam one by reading the email; only calling the number already on file can.",
    },
    {
      title: "Rush wording pushes you to skip the call",
      detail: "\"The artist will pull out,\" \"need this today\" — real emergencies use the same words as scams. Under rush pressure, the call that would have caught it is the first thing to get skipped.",
    },
    {
      title: "No one re-checks the number in the email",
      detail: "A scam email includes its own \"updated\" contact details. A person calling that number just confirms the scam to itself; hold always calls the number already on file, never one from the email.",
    },
  ];

  return {
    invoicesReviewed: rows.length,
    scamsInSet: scamRows.length,
    scamsCaught,
    moneyHeldBackCents,
    moneyLostWithoutHoldCents,
    falsePositives,
    falsePositiveNotes,
    phoneCallsPlaced,
    staffMinutesSaved: rows.length * MINUTES_PER_MANUAL_CHECK,
    minutesPerManualCheck: MINUTES_PER_MANUAL_CHECK,
    why,
  };
}
