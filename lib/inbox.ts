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

/**
 * What the Inbox shows: a bill status, your open messages from suppliers, or the quiet view of
 * messages that are done or filed. Absent = everything open: every bill plus open messages.
 */
export type InboxView = DataBillStatus | "messages" | "filed";

export interface InboxFilter {
  view?: InboxView;
  label: string;
}

export const INBOX_FILTERS: InboxFilter[] = [
  { label: "All" },
  { view: "Needs you", label: "Needs you" },
  { view: "messages", label: "Messages" },
  { view: "Held", label: "Held" },
  { view: "Calling", label: "Calling" },
  { view: "Checking", label: "Checking" },
  { view: "Scheduled", label: "Scheduled" },
  { view: "Paid", label: "Paid" },
];

const VIEWS = new Set<string>([...INBOX_FILTERS.flatMap((f) => (f.view ? [f.view] : [])), "filed"]);

/** A ?view= value from the URL, or undefined (All) when it isn't one. */
export function parseView(v: string | undefined): InboxView | undefined {
  return v && VIEWS.has(v) ? (v as InboxView) : undefined;
}

export type InboxItem<B, M> = { kind: "bill"; bill: B; at: string } | { kind: "message"; message: M; at: string };

/** One ledger, newest first: bills and supplier messages for the chosen view. */
export function inboxItems<B extends { status: DataBillStatus; receivedAt: string }, M extends { receivedAt: string }>(
  bills: B[],
  messages: { open: M[]; done: M[]; filed: M[] },
  view: InboxView | undefined,
): InboxItem<B, M>[] {
  const asBills = (bs: B[]) => bs.map((bill) => ({ kind: "bill" as const, bill, at: bill.receivedAt }));
  const asMessages = (ms: M[]) => ms.map((message) => ({ kind: "message" as const, message, at: message.receivedAt }));
  const items: InboxItem<B, M>[] =
    view === undefined
      ? [...asBills(bills), ...asMessages(messages.open)]
      : view === "messages"
        ? asMessages(messages.open)
        : view === "filed"
          ? asMessages([...messages.done, ...messages.filed])
          : asBills(bills.filter((b) => b.status === view));
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** A message's mark: open ones are waiting on you; done and filed ones are settled, so grey. */
export const MESSAGE_MARK: Record<"open" | "done" | "filed", { status: BillStatus; label: string }> = {
  open: { status: "needs-you", label: "Needs you" },
  done: { status: "paid", label: "Done" },
  filed: { status: "paid", label: "Filed" },
};

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
