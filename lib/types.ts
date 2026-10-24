// Shared shapes returned by lib/data.ts. Swapping the data source to Convex
// queries later should only require changes inside lib/data.ts — every
// screen imports these types, not the raw fogline.json shape.

export type DataBillStatus = "Paid" | "Scheduled" | "Checking" | "Calling" | "Held" | "Needs you";

export interface Supplier {
  key: string;
  name: string;
  category: "stage" | "sound" | "security" | "agency" | "food" | "other";
  domain: string;
  contactName: string;
  contactEmail: string;
  trustedPhone: string;
  phoneLastCheckedAt: string;
}

export interface BankAccount {
  key: string;
  supplierKey: string;
  bank: string;
  last4: string;
  routingLast4: string;
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
  outcome: "confirmed" | "not_confirmed" | "handed_off";
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
  thread: Array<{ from: string; text: string; at: string }>;
}

export type ActivityActor = "callback" | "maya" | "dev";

export interface ActivityEntry {
  key: string;
  actor: ActivityActor;
  what: string;
  why: string;
  refKind: string;
  refKey: string;
  at: string;
}
