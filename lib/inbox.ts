// Inbox-screen-only helpers: status casing between lib/types' DataBillStatus
// ("Paid" …) and the design system's BillStatus ("paid" …), the filter list,
// and small display formatting. Nothing here touches shared data access.

import type { DataBillStatus } from "./types";
import type { BillStatus } from "@/components/callback";

export const STATUS_TO_MARK: Record<DataBillStatus, BillStatus> = {
  Paid: "paid",
  Scheduled: "scheduled",
  Checking: "checking",
  Calling: "calling",
  Held: "held",
  "Needs you": "needs-you",
};

/** Bills Callback hasn't settled yet; rendered unread in the ledger. */
export const UNSETTLED_STATUS: Record<DataBillStatus, boolean> = {
  Paid: false,
  Scheduled: false,
  Checking: true,
  Calling: true,
  Held: true,
  "Needs you": true,
};

export interface InboxFilter {
  status?: DataBillStatus;
  label: string;
}

export const INBOX_FILTERS: InboxFilter[] = [
  { label: "All" },
  { status: "Needs you", label: "Needs you" },
  { status: "Held", label: "Held" },
  { status: "Calling", label: "Calling" },
  { status: "Checking", label: "Checking" },
  { status: "Scheduled", label: "Scheduled" },
  { status: "Paid", label: "Paid" },
];

export function emailPreview(body: string): string {
  const line = body
    .split(/\n+/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^(hi|hello|dear|hey)\b/i.test(l));
  if (!line) return "";
  return line.length > 90 ? line.slice(0, 89) + "\u2026" : line;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
