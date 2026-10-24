// Who hold works for. One company per deployment; the settings row names which one (convex/app/company.ts).
// Every screen, prompt, call script and rule reads its name, words and limits from here,
// so the same engine runs a festival's bills, a title company's closing wires or a clinic's payroll.
// Nobody is named: the one approver is the internal key "dev", never shown.

export type CompanyKey = "fogline" | "bayline" | "harbor";

export interface Noun {
  one: string;
  many: string;
}

export interface Company {
  key: CompanyKey;
  name: string;
  /** Possessive, for "Fogline's accounts team". */
  owner: string;
  /** One clause for prompts: who the company is. */
  about: string;
  /** "accounts team": who answers the phone and places check calls. */
  team: string;
  /** What hold does for the company, under its name in the sidebar: "Accounts payable", "Escrow", "Payroll". */
  dept: string;
  inbox: string;
  /** Who gets paid: suppliers, closing parties, employees. */
  payee: Noun;
  /** What a payment request is: a bill, a disbursement, a paycheck. */
  bill: Noun;
  /** What one entry in a payee's history is called on a call: "your September invoice". */
  record: string;
  /** How to ask a payee about their history on a check call: what they would know and what they wouldn't. */
  questionHint: string;
  /** What the company's own file on a payee records (check calls ask about it), by the note's field. */
  facts: { hiredFor: string; agreed: string; dates: string; foglineContact: string };
  /** Payee groups, key -> label. A payee's category is one of these keys. */
  categories: Record<string, string>;
  /** hold pays on its own below this; at or above it the approver signs off. */
  approvalLimitCents: number;
  /** The approver's job title, lowercase noun: "controller", "escrow officer". Never a person's name. */
  approver: string;
  /** For retry times and calling hours. */
  timeZone: string;
}

const fogline: Company = {
  key: "fogline",
  name: "Fogline",
  owner: "Fogline's",
  about: "Fogline, a 3-day music festival in San Francisco",
  team: "accounts team",
  dept: "Accounts payable",
  inbox: "bills@fogline.fm",
  payee: { one: "supplier", many: "suppliers" },
  bill: { one: "bill", many: "bills" },
  record: "invoice",
  questionHint: "Suppliers can look up their invoices by number and month, and know what each was for and what it totaled.",
  facts: {
    hiredFor: "What Fogline hired them for",
    agreed: "What was agreed (price, terms)",
    dates: "Dates",
    foglineContact: "Who at Fogline arranged it",
  },
  categories: { stage: "Stage", sound: "Sound", security: "Security", agency: "Artist agencies", food: "Food", other: "Site services" },
  approvalLimitCents: 1_000_000,
  approver: "controller",
  timeZone: "America/Los_Angeles",
};

const bayline: Company = {
  key: "bayline",
  name: "Bayline Title",
  owner: "Bayline Title's",
  about: "Bayline Title & Escrow, a title and escrow company in Oakland that closes home sales and wires the money",
  team: "escrow team",
  dept: "Escrow",
  inbox: "closings@baylinetitle.com",
  payee: { one: "party", many: "parties" },
  bill: { one: "disbursement", many: "disbursements" },
  record: "disbursement",
  questionHint:
    "Lenders and agents can look up a file by its escrow number (written like 26-1179). A home seller knows the property address, the closing date and roughly what the sale came to, but not internal numbers; ask a seller about their escrow file, never about other closings.",
  facts: {
    hiredFor: "Their role in the closing",
    agreed: "What the settlement statement says",
    dates: "Closing date",
    foglineContact: "Escrow officer on the file",
  },
  categories: { seller: "Sellers", lender: "Loan payoffs", agent: "Agent commissions", vendor: "Closing vendors" },
  approvalLimitCents: 2_500_000,
  approver: "escrow officer",
  timeZone: "America/Los_Angeles",
};

const harbor: Company = {
  key: "harbor",
  name: "Harbor Health",
  owner: "Harbor Health's",
  about: "Harbor Health, a group of four community clinics in San Diego that runs its own payroll",
  team: "payroll team",
  dept: "Payroll",
  inbox: "payroll@harborhealth.org",
  payee: { one: "employee", many: "employees" },
  bill: { one: "paycheck", many: "paychecks" },
  record: "paycheck",
  questionHint:
    "Employees don't know paycheck numbers: name a paycheck by its pay date, ask roughly what it came to, or ask about their role, clinic, manager or start date from their HR file.",
  facts: {
    hiredFor: "Role and clinic",
    agreed: "Pay (rate and schedule)",
    dates: "Start date",
    foglineContact: "Manager",
  },
  categories: { nursing: "Nursing", clinicians: "Clinicians", front: "Front desk", facilities: "Facilities" },
  approvalLimitCents: 500_000,
  approver: "payroll director",
  timeZone: "America/Los_Angeles",
};

export const COMPANIES: Record<CompanyKey, Company> = { fogline, bayline, harbor };

export function companyFor(key: string | undefined): Company {
  return COMPANIES[key as CompanyKey] ?? fogline;
}

/** "$10,000" for the approval limit and other whole amounts. */
export function wholeDollars(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Supplier", "Party", "Employee". */
export const capital = (n: Noun) => ({ one: cap(n.one), many: cap(n.many) });

/** "es" -> "Spanish", for screens. Unknown codes come back as written. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A role mid-sentence: "Controller" -> "controller", but "HR director" stays as it is. */
export const inSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
