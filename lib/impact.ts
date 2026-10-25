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

export interface ImpactStats {
  invoicesReviewed: number;
  scamsInSet: number;
  scamsCaught: number;
  moneyHeldBackCents: number;
  paidOutCents: number;
  falsePositives: number;
  falsePositiveNotes: string[];
  phoneCallsPlaced: number;
  staffMinutesSaved: number;
  minutesPerManualCheck: number;
}

const rows = impactSet as ImpactRow[];

/** Honest numbers for the Impact page: every bill in the fixed set run through hold's real
 * checks right now. "Caught" = hold's decision isn't a flat pay; "false positive" = an ordinary
 * bill hold's checks flag for a call even though nothing was wrong. */
export function getImpactStats(): ImpactStats {
  let scamsCaught = 0;
  let moneyHeldBackCents = 0;
  let paidOutCents = 0;
  let falsePositives = 0;
  let phoneCallsPlaced = 0;
  const falsePositiveNotes: string[] = [];

  for (const row of rows) {
    const checks = runChecks(row);
    const decision = decide(checks, row.amountCents);
    const flagged = decision === "call";
    if (flagged) phoneCallsPlaced++;
    else paidOutCents += row.amountCents;
    if (row.isScam) {
      if (flagged) {
        scamsCaught++;
        moneyHeldBackCents += row.amountCents;
      }
    } else if (flagged) {
      falsePositives++;
      if (row.note) falsePositiveNotes.push(row.note);
    }
  }

  const scamsInSet = rows.filter((r) => r.isScam).length;

  return {
    invoicesReviewed: rows.length,
    scamsInSet,
    scamsCaught,
    moneyHeldBackCents,
    paidOutCents,
    falsePositives,
    falsePositiveNotes,
    phoneCallsPlaced,
    staffMinutesSaved: rows.length * MINUTES_PER_MANUAL_CHECK,
    minutesPerManualCheck: MINUTES_PER_MANUAL_CHECK,
  };
}
