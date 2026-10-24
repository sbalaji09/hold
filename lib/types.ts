// Shared shapes returned by lib/data.ts. Swapping the data source to Convex
// queries later should only require changes inside lib/data.ts — every
// screen imports these types, not the raw fogline.json shape.

export type DataBillStatus = "Paid" | "Scheduled" | "Checking" | "Calling" | "Held" | "Needs you";

export interface Supplier {
  key: string;
  name: string;
  /** A key of the company's categories (lib/company.ts), or "other". */
  category: string;
  domain: string;
  contactName: string;
  contactEmail: string;
  trustedPhone: string;
  phoneLastCheckedAt: string;
  /** Absent = trusted. */
  status?: "new" | "trusted" | "under_review";
  /** Check calls: language spoken ("en", "es"), keys to reach them through a phone menu, their time zone. */
  language?: string;
  phoneMenu?: string;
  timeZone?: string;
  /** New suppliers only: how hold met them and Fogline's own facts about the engagement. */
  onboarding?: {
    source: "email" | "manual";
    firstBillKey?: string;
    emailPhones: string[];
    note?: { hiredFor: string; agreed: string; dates: string; foglineContact: string };
    confirmedBy?: "dev";
    confirmedAt?: string;
  };
}

export interface BankAccount {
  key: string;
  supplierKey: string;
  bank: string;
  last4: string;
  routingLast4: string;
  // Full sandbox routing/account numbers, read server-side only (convex/app/increase.ts).
  // Never populated on anything returned to the client; AccountLine only ever shows last4.
  routingNumber?: string;
  accountNumber?: string;
  status: "active" | "retired";
  verifiedBy: "onboarding" | "call+dev";
  addedAt: string;
}

export interface Email {
  key: string;
  billKey: string | null;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  body: string;
  receivedAt: string;
  direction: "in" | "out";
}

export interface Payment {
  key: string;
  billKey: string;
  amountCents: number;
  bankAccountKey: string;
  status: string;
  transferId?: string;
  paidAt: string;
}

export interface CallTurn {
  speaker: "callback" | "supplier";
  text: string;
  ts: number;
}

export interface Call {
  key: string;
  supplierKey: string;
  billKey: string;
  direction: "out";
  startedAt: string;
  summary: string;
  transcript: CallTurn[];
  outcome: "confirmed" | "not_confirmed" | "handed_off" | "needs_review";
}

/** A reference to the record a claim came from, e.g. an email or a past bill. */
export interface Cite {
  kind: "email" | "bill" | "supplier" | "call" | "payment";
  ref: string;
}

export type CheckState = "pass" | "flag" | "info";

export interface Check {
  id: string;
  label: string;
  state: CheckState;
  /** Real numbers, measured against the supplier's own history. */
  evidence: string;
  quote?: string;
  cite: Cite;
}

export interface Bill {
  key: string;
  supplierKey: string;
  invoiceNo: string;
  amountCents: number;
  currency: "USD";
  dueDate: string;
  receivedAt: string;
  bankAccountKey: string;
  status: DataBillStatus;
  emailKey: string;
  planted: boolean;
  supplier: Supplier;
  bankAccount: BankAccount;
  email: Email;
  payment: Payment | null;
  call: Call | null;
  checks: Check[];
}

export interface BillListFilter {
  status?: DataBillStatus;
}

export type ApprovalKind = "big_payment" | "held_payment" | "bank_change";

export interface Approval {
  key: string;
  billKey: string;
  bill: Bill;
  kind: ApprovalKind;
  status: "pending";
  /** Callback's recommendation, in its own voice. */
  recommendation: string;
  routedTo?: "dev";
  reason?: string;
  thread: Array<{ from: string; text: string; at: string }>;
}

export type ActivityActor = "callback" | "dev";

export interface ActivityEntry {
  key: string;
  actor: ActivityActor;
  what: string;
  why: string;
  refKind: string;
  refKey: string;
  at: string;
}

export interface LearnedRule {
  key: string;
  supplierKey: string;
  text: string;
  createdBy: "dev";
  sourceKind: string;
  sourceKey: string;
  createdAt: string;
}

export interface BackgroundCheck {
  key: string;
  kind: "background" | "copycat";
  supplierKey?: string;
  billKey?: string;
  domain: string;
  ranAt: string;
  findings: Array<{ label: string; state: "pass" | "flag" | "info"; evidence: string; sourceUrl?: string }>;
  suggestedPhone?: string;
}

export interface Settings {
  watchOnly: boolean;
  /** The approver is out: hold doesn't ask them mid-call; unsure answers wait for review. */
  away?: boolean;
}
