// Deterministic seed data for the two other company templates (lib/company.ts):
//   bayline.json - Bayline Title & Escrow: closing disbursements to sellers, lenders, agents, vendors.
//   harbor.json  - Harbor Health: biweekly paychecks to clinic employees.
// Same shape as fogline.json (convex/seed.ts). Run: npx tsx data/generateWorkspaces.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------- shared shapes and helpers ----------

interface Note {
  hiredFor: string;
  agreed: string;
  dates: string;
  foglineContact: string;
}
interface Payee {
  key: string;
  name: string;
  category: string;
  domain: string;
  contactName: string;
  contactEmail: string;
  trustedPhone: string;
  phoneLastCheckedAt: string;
  language?: string;
  phoneMenu?: string;
  onboarding?: { source: "manual"; emailPhones: string[]; note: Note };
}
interface Account {
  key: string;
  supplierKey: string;
  bank: string;
  last4: string;
  routingLast4: string;
  routingNumber: string;
  accountNumber: string;
  status: "active" | "retired";
  verifiedBy: "onboarding" | "call+dev";
  addedAt: string;
}
type Status = "Paid" | "Scheduled" | "Checking" | "Calling" | "Held" | "Needs you";
interface Bill {
  key: string;
  supplierKey: string;
  invoiceNo: string;
  amountCents: number;
  currency: "USD";
  dueDate: string;
  receivedAt: string;
  bankAccountKey: string;
  status: Status;
  emailKey: string;
  planted: boolean;
}
interface Email {
  key: string;
  billKey: string | null;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  body: string;
  receivedAt: string;
  direction: "in";
}
interface Payment {
  key: string;
  billKey: string;
  amountCents: number;
  bankAccountKey: string;
  status: "Paid";
  transferId: string;
  paidAt: string;
}
interface Turn {
  speaker: "callback" | "supplier";
  text: string;
  ts: number;
}
interface Call {
  key: string;
  supplierKey: string;
  billKey: string | null;
  direction: "out";
  startedAt: string;
  summary: string;
  transcript: Turn[];
  outcome: "confirmed" | "not_confirmed" | "handed_off";
}
interface Scam {
  key: string;
  billKey: string;
  kind: string;
  description: string;
  checksThatShouldFire: string[];
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable digits from a string, so account numbers never change between runs. */
function digits(seed: string, n: number): string {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let out = "";
  const r = mulberry32(h >>> 0);
  while (out.length < n) out += Math.floor(r() * 10);
  return out;
}

const usd = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);
const at = (date: string, hour = 9) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-07:00`).toISOString();
const addDays = (date: string, n: number) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

function account(supplierKey: string, suffix: string, bank: string, addedAt: string, extra: Partial<Account> = {}): Account {
  const key = `bank_${supplierKey.replace(/^[a-z]+_/, "")}${suffix}`;
  const last4 = digits(`${key}:last4`, 4);
  const routingLast4 = digits(`${key}:routing`, 4);
  return {
    key,
    supplierKey,
    bank,
    last4,
    routingLast4,
    routingNumber: digits(`${key}:r`, 5) + routingLast4,
    accountNumber: digits(`${key}:a`, 6) + last4,
    status: "active",
    verifiedBy: "onboarding",
    addedAt,
    ...extra,
  };
}

/** Opening line of every check call, as the voice server says it. */
const disclosure = (company: string, team: string) =>
  `Hi, this is an automated assistant calling for ${company}'s ${team}. This call is recorded.`;

class Book {
  bills: Bill[] = [];
  emails: Email[] = [];
  payments: Payment[] = [];
  calls: Call[] = [];
  plantedScams: Scam[] = [];
  private transfer = 50000;

  constructor(private readonly prefix: string) {}

  /** One payment request with the email that asked for it, and the payment if it went out. */
  add(o: {
    payee: Payee;
    no: string;
    cents: number;
    received: string;
    due: string;
    account: Account;
    status: Status;
    subject: string;
    body: string;
    from?: string;
    planted?: boolean;
  }): Bill {
    const key = `bill_${this.prefix}${o.no}`;
    const emailKey = `email_${this.prefix}${o.no}`;
    const from = o.from ?? o.payee.contactEmail;
    this.emails.push({
      key: emailKey,
      billKey: key,
      fromAddress: from,
      fromDomain: from.split("@")[1]!,
      subject: o.subject,
      body: o.body,
      receivedAt: o.received,
      direction: "in",
    });
    const bill: Bill = {
      key,
      supplierKey: o.payee.key,
      invoiceNo: o.no,
      amountCents: o.cents,
      currency: "USD",
      dueDate: o.due,
      receivedAt: o.received,
      bankAccountKey: o.account.key,
      status: o.status,
      emailKey,
      planted: o.planted ?? false,
    };
    this.bills.push(bill);
    if (o.status === "Paid") {
      this.payments.push({
        key: `pay_${this.prefix}${o.no}`,
        billKey: key,
        amountCents: o.cents,
        bankAccountKey: o.account.key,
        status: "Paid",
        transferId: `transfer_${this.prefix}${this.transfer++}`,
        paidAt: at(o.due, 10),
      });
    }
    return bill;
  }

  scam(bill: Bill, kind: string, description: string, checks: string[]) {
    this.plantedScams.push({ key: `scam_${bill.key.replace(/^bill_/, "")}`, billKey: bill.key, kind, description, checksThatShouldFire: checks });
  }

  call(c: Omit<Call, "direction">) {
    this.calls.push({ ...c, direction: "out" });
  }

  output() {
    return { bills: this.bills, emails: this.emails, payments: this.payments, calls: this.calls, plantedScams: this.plantedScams };
  }
}

// ---------- Harbor Health: payroll ----------

function harbor() {
  const co = { name: "Harbor Health", team: "payroll team" };
  const domain = "harborhealth.org";
  const phone = (n: number) => `+16195550${String(200 + n).padStart(3, "0")}`;
  const people: Array<{ key: string; name: string; cat: string; role: string; rate: string; start: string; manager: string; net: number; bank: string; lang?: string }> = [
    { key: "emp_gutierrez", name: "María Gutiérrez", cat: "facilities", role: "Environmental services tech at the National City clinic", rate: "$22.10 an hour, paid every other Friday", start: "Started March 2022", manager: "Manager: Ray Castillo", net: 171_840, bank: "Wells Fargo", lang: "es" },
    { key: "emp_rivera", name: "Luis Rivera", cat: "nursing", role: "Registered nurse at the Chula Vista clinic", rate: "$58.40 an hour, paid every other Friday", start: "Started June 2023", manager: "Manager: Teresa Vance", net: 356_210, bank: "Chase" },
    { key: "emp_okoye", name: "Ngozi Okoye", cat: "nursing", role: "Registered nurse at the Barrio Logan clinic", rate: "$57.10 an hour, paid every other Friday", start: "Started January 2021", manager: "Manager: Teresa Vance", net: 349_880, bank: "Chase" },
    { key: "emp_chen", name: "Wendy Chen", cat: "nursing", role: "Licensed vocational nurse at the Chula Vista clinic", rate: "$34.75 an hour, paid every other Friday", start: "Started September 2024", manager: "Manager: Teresa Vance", net: 231_460, bank: "Bank of America" },
    { key: "emp_kim", name: "Grace Kim", cat: "nursing", role: "Certified nursing assistant at the National City clinic", rate: "$24.30 an hour, paid every other Friday", start: "Started April 2025", manager: "Manager: Teresa Vance", net: 168_920, bank: "US Bank" },
    { key: "emp_patel", name: "Anil Patel", cat: "clinicians", role: "Family physician, medical director of the Barrio Logan clinic", rate: "$248,000 a year, paid every other Friday", start: "Started August 2019", manager: "Reports to Dana Whitfield", net: 862_400, bank: "Union Bank" },
    { key: "emp_nguyen", name: "Hoa Nguyen", cat: "clinicians", role: "Nurse practitioner at the Chula Vista clinic", rate: "$146,000 a year, paid every other Friday", start: "Started February 2022", manager: "Manager: Dr. Anil Patel", net: 523_150, bank: "Navy Federal" },
    { key: "emp_brooks", name: "Kayla Brooks", cat: "front", role: "Front desk lead at the Chula Vista clinic", rate: "$25.60 an hour, paid every other Friday", start: "Started May 2023", manager: "Manager: Ines Moreno", net: 182_330, bank: "Chase" },
    { key: "emp_haddad", name: "Sami Haddad", cat: "front", role: "Patient scheduler at the Barrio Logan clinic", rate: "$23.20 an hour, paid every other Friday", start: "Started November 2024", manager: "Manager: Ines Moreno", net: 163_780, bank: "Wells Fargo" },
    { key: "emp_lopez", name: "Rosa López", cat: "front", role: "Medical receptionist at the National City clinic", rate: "$22.80 an hour, paid every other Friday", start: "Started July 2021", manager: "Manager: Ines Moreno", net: 160_940, bank: "Golden 1", lang: "es" },
    { key: "emp_wallace", name: "Derek Wallace", cat: "facilities", role: "Facilities technician for all four clinics", rate: "$29.50 an hour, paid every other Friday", start: "Started October 2020", manager: "Manager: Ray Castillo", net: 214_670, bank: "US Bank" },
    { key: "emp_santos", name: "Joel Santos", cat: "facilities", role: "Courier and supply runner for all four clinics", rate: "$21.40 an hour, paid every other Friday", start: "Started June 2024", manager: "Manager: Ray Castillo", net: 152_210, bank: "Bank of America", lang: "es" },
  ];

  const payees: Payee[] = people.map((p, i) => {
    const [first, ...rest] = p.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(" ");
    return {
      key: p.key,
      name: p.name,
      category: p.cat,
      domain,
      contactName: p.name,
      contactEmail: `${first}.${rest.join("")}@${domain}`,
      trustedPhone: phone(i),
      phoneLastCheckedAt: "2026-09-02",
      ...(p.lang ? { language: p.lang } : {}),
      onboarding: { source: "manual", emailPhones: [], note: { hiredFor: p.role, agreed: p.rate, dates: p.start, foglineContact: p.manager } },
    };
  });
  const byKey = new Map(payees.map((p) => [p.key, p]));
  const accounts = people.map((p) => account(p.key, "", p.bank, "2025-01-06"));
  const acctOf = new Map(accounts.map((a) => [a.supplierKey, a]));

  // Ngozi Okoye moved banks in August: verified by a call to her number on file and Dana's approval.
  const okoyeOld = acctOf.get("emp_okoye")!;
  okoyeOld.status = "retired";
  const okoyeNew = account("emp_okoye", "_2", "Navy Federal", "2026-08-05", { verifiedBy: "call+dev" });
  accounts.push(okoyeNew);

  const book = new Book("h");
  const rng = mulberry32(20261023);
  const paydays: string[] = [];
  for (let d = "2026-05-15"; d <= "2026-10-16"; d = addDays(d, 14)) paydays.push(d);

  paydays.forEach((payday, run) => {
    const periodEnd = addDays(payday, -6);
    const periodStart = addDays(periodEnd, -13);
    people.forEach((p, i) => {
      const overtime = rng() < 0.18;
      const cents = Math.round(p.net * (0.98 + rng() * 0.04) * (overtime ? 1.07 : 1));
      const acct = p.key === "emp_okoye" && payday >= "2026-08-07" ? okoyeNew : acctOf.get(p.key)!;
      const hours = overtime ? `80 regular and ${4 + Math.floor(rng() * 6)} overtime` : "80 regular";
      book.add({
        payee: byKey.get(p.key)!,
        no: `${1031 + run}-${String(i + 1).padStart(2, "0")}`,
        cents,
        received: at(periodEnd, 17),
        due: payday,
        account: acct,
        status: "Paid",
        subject: `Timesheet ${longDate(periodStart)} – ${longDate(periodEnd)}`,
        body: `Hi payroll,\n\nMy hours for ${longDate(periodStart)} to ${longDate(periodEnd)}: ${hours}. Approved by my manager in the scheduling system.\n\nThanks,\n${p.name.split(" ")[0]}`,
      });
    });
  });

  // The Oct 30 run: timesheets are in. Anil's paycheck is over the $5,000 limit, so Dana signs off.
  const nextRun = 1031 + paydays.length;
  const scams = new Set(["emp_rivera", "emp_patel", "emp_brooks"]);
  people.forEach((p, i) => {
    if (scams.has(p.key)) return;
    book.add({
      payee: byKey.get(p.key)!,
      no: `${nextRun}-${String(i + 1).padStart(2, "0")}`,
      cents: p.net,
      received: at("2026-10-22", 16),
      due: "2026-10-30",
      account: p.key === "emp_okoye" ? okoyeNew : acctOf.get(p.key)!,
      status: p.net >= 500_000 ? "Needs you" : "Scheduled",
      subject: "Timesheet October 11 – October 24",
      body: `Hi payroll,\n\nMy hours for October 11 to October 24: 80 regular. Approved by my manager in the scheduling system.\n\nThanks,\n${p.name.split(" ")[0]}`,
    });
  });

  // Okoye's verified bank change (August).
  book.emails.push({
    key: "email_h_okoye_bank",
    billKey: null,
    fromAddress: byKey.get("emp_okoye")!.contactEmail,
    fromDomain: domain,
    subject: "Direct deposit change",
    body: "Hi Jordan,\n\nI moved my checking account to Navy Federal. Can you update my direct deposit starting with the next paycheck? I'm on shift this week, my cell is the one HR has.\n\nThanks,\nNgozi",
    receivedAt: at("2026-08-03", 11),
    direction: "in",
  });
  book.call({
    key: "call_h_okoye_verify",
    supplierKey: "emp_okoye",
    billKey: null,
    startedAt: at("2026-08-04", 13),
    summary: "Ngozi confirmed on her number on file that she asked to move her direct deposit to Navy Federal, and knew her start date and manager. Dana approved the new account.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "I'm calling to double-check a direct deposit change. Who is your manager at Harbor Health?", ts: 6 },
      { speaker: "supplier", text: "That's Teresa Vance.", ts: 11 },
      { speaker: "callback", text: "Thanks. Did you recently change your bank account?", ts: 14 },
      { speaker: "supplier", text: "Yes, I emailed Jordan yesterday. I switched to Navy Federal.", ts: 18 },
    ],
    outcome: "confirmed",
  });

  // Three planted payroll-diversion attempts on the Oct 30 run.
  const rivera = byKey.get("emp_rivera")!;
  const r = book.add({
    payee: rivera,
    no: `${nextRun}-02`,
    cents: 356_210,
    received: at("2026-10-21", 22),
    due: "2026-10-30",
    account: acctOf.get("emp_rivera")!,
    status: "Held",
    from: "luis.rivera.rn@gmail.com",
    subject: "Direct deposit update before Friday",
    body: "Hi payroll,\n\nPlease update my direct deposit to my new account at Chime before this Friday's paycheck. I'm traveling and can't get to the HR portal, so email is the best way to reach me. Please do this ASAP.\n\nThanks,\nLuis Rivera, RN",
    planted: true,
  });
  book.scam(r, "free-email impersonation + direct deposit change + rush language", "An email signed Luis Rivera from a gmail address (Harbor's record lists luis.rivera@harborhealth.org) asks to move his paycheck to a new Chime account before Friday and to reply only by email.", ["look-alike domain", "new bank account", "rush language"]);
  book.call({
    key: "call_h_rivera_scam",
    supplierKey: "emp_rivera",
    billKey: r.key,
    startedAt: at("2026-10-22", 10),
    summary: "Luis said on his number on file that he never asked to change his direct deposit and doesn't use Chime.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "I'm calling to double-check a direct deposit change. Did you recently change your bank account?", ts: 6 },
      { speaker: "supplier", text: "No. I didn't ask for any change, and I don't have a Chime account. Is someone trying to take my paycheck?", ts: 12 },
    ],
    outcome: "not_confirmed",
  });

  const patel = byKey.get("emp_patel")!;
  const pt = book.add({
    payee: patel,
    no: `${nextRun}-06`,
    cents: 862_400,
    received: at("2026-10-20", 7),
    due: "2026-10-30",
    account: acctOf.get("emp_patel")!,
    status: "Held",
    from: "anil.patel@harborhealth-hr.com",
    subject: "Urgent: route my paycheck to new account",
    body: "Jordan,\n\nI'm in clinic all day, no calls please. Route this paycheck to my new account at Mercury, routing and account below. It needs to be in place today.\n\nDr. Anil Patel\nMedical Director, Barrio Logan",
    planted: true,
  });
  book.scam(pt, "executive impersonation + look-alike domain + direct deposit change", "A look-alike domain (harborhealth-hr.com) poses as the medical director, asks to move an $8,624 paycheck to a new Mercury account today and says not to call.", ["look-alike domain", "new bank account", "rush language"]);
  book.call({
    key: "call_h_patel_scam",
    supplierKey: "emp_patel",
    billKey: pt.key,
    startedAt: at("2026-10-20", 12),
    summary: "Dr. Patel said on his number on file that he sent no email and hasn't changed banks.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "I'm calling to double-check a direct deposit change. Which clinic are you based at?", ts: 6 },
      { speaker: "supplier", text: "Barrio Logan.", ts: 10 },
      { speaker: "callback", text: "Thanks. Did you recently change your bank account?", ts: 13 },
      { speaker: "supplier", text: "No, I haven't changed anything and I didn't send any email today.", ts: 17 },
    ],
    outcome: "not_confirmed",
  });

  const brooks = byKey.get("emp_brooks")!;
  const br = book.add({
    payee: brooks,
    no: `${nextRun}-08`,
    cents: 182_330,
    received: at("2026-10-22", 6),
    due: "2026-10-30",
    account: acctOf.get("emp_brooks")!,
    status: "Needs you",
    subject: "New bank for direct deposit",
    body: "Hi,\n\nI switched banks. Please send my direct deposit to my new account starting with this paycheck. New details are on the attached form.\n\nKayla",
    planted: true,
  });
  book.scam(br, "compromised mailbox + direct deposit change", "Kayla's real address asks to move her direct deposit to a new account; the check call to her number on file went unanswered twice.", ["new bank account"]);
  book.call({
    key: "call_h_brooks_scam",
    supplierKey: "emp_brooks",
    billKey: br.key,
    startedAt: at("2026-10-22", 11),
    summary: "No answer on Kayla's number on file, retried once, handed to Jordan.",
    transcript: [{ speaker: "callback", text: disclosure(co.name, co.team), ts: 0 }],
    outcome: "handed_off",
  });

  return { company: "harbor", hero: "emp_gutierrez", suppliers: payees, bankAccounts: accounts, ...book.output() };
}

// ---------- Bayline Title & Escrow: closing disbursements ----------

function bayline() {
  const co = { name: "Bayline Title", team: "escrow team" };
  const phone = (n: number) => `+15105550${String(300 + n).padStart(3, "0")}`;
  const P = (o: Omit<Payee, "phoneLastCheckedAt" | "trustedPhone"> & { n: number; phoneLastCheckedAt?: string }): Payee => {
    const { n, ...rest } = o;
    return { phoneLastCheckedAt: "2026-08-18", trustedPhone: phone(n), ...rest };
  };
  const payees: Payee[] = [
    P({ n: 0, key: "sel_delgado", name: "Marcia Delgado", category: "seller", domain: "gmail.com", contactName: "Marcia Delgado", contactEmail: "marcia.delgado@gmail.com",
      onboarding: { source: "manual", emailPhones: [], note: { hiredFor: "Selling 418 Alcatraz Ave, Oakland (escrow 26-1188)", agreed: "Sale price $1,085,000; proceeds go to the account on her signed seller instructions", dates: "Closing October 28, 2026", foglineContact: "Lena Park" } } }),
    P({ n: 1, key: "sel_whitaker", name: "Tom Whitaker", category: "seller", domain: "sbcglobal.net", contactName: "Tom Whitaker", contactEmail: "tomwhitaker@sbcglobal.net",
      onboarding: { source: "manual", emailPhones: [], note: { hiredFor: "Selling 2215 Woolsey St, Berkeley (escrow 26-1131) with Ellen Whitaker", agreed: "Sale price $1,420,000", dates: "Closed August 14, 2026", foglineContact: "Lena Park" } } }),
    P({ n: 2, key: "sel_ochoa", name: "Ramón Ochoa", category: "seller", domain: "yahoo.com", contactName: "Ramón Ochoa", contactEmail: "ramon.ochoa61@yahoo.com", language: "es",
      onboarding: { source: "manual", emailPhones: [], note: { hiredFor: "Selling 3307 Galindo St, Oakland (escrow 26-1158)", agreed: "Sale price $735,000", dates: "Closed September 22, 2026", foglineContact: "Lena Park" } } }),
    P({ n: 3, key: "len_pacific", name: "Pacific Home Loans", category: "lender", domain: "pacifichomeloans.com", contactName: "Payoff department", contactEmail: "payoffs@pacifichomeloans.com", phoneMenu: "ww2" }),
    P({ n: 4, key: "len_bayfed", name: "Bay Federal Credit Union", category: "lender", domain: "bayfed.org", contactName: "Loan servicing", contactEmail: "servicing@bayfed.org", phoneMenu: "ww3" }),
    P({ n: 5, key: "len_summit", name: "Summit Mortgage Servicing", category: "lender", domain: "summitservicing.com", contactName: "Payoff desk", contactEmail: "payoff@summitservicing.com", phoneMenu: "ww1ww4" }),
    P({ n: 6, key: "agt_bayside", name: "Bayside Realty Group", category: "agent", domain: "baysiderealty.com", contactName: "Andrea Lowe", contactEmail: "commissions@baysiderealty.com" }),
    P({ n: 7, key: "agt_keystone", name: "Keystone Properties", category: "agent", domain: "keystoneprops.com", contactName: "Devon Price", contactEmail: "commissions@keystoneprops.com" }),
    P({ n: 8, key: "agt_lakeshore", name: "Lakeshore Homes Realty", category: "agent", domain: "lakeshorehomes.com", contactName: "Priya Raman", contactEmail: "accounting@lakeshorehomes.com" }),
    P({ n: 9, key: "ven_recorder", name: "Alameda County Recorder", category: "vendor", domain: "acgov.org", contactName: "Recording desk", contactEmail: "recorder@acgov.org" }),
    P({ n: 10, key: "ven_hoa", name: "Lake Merritt HOA", category: "vendor", domain: "lakemerritthoa.org", contactName: "Gail Foster", contactEmail: "treasurer@lakemerritthoa.org" }),
    P({ n: 11, key: "ven_termite", name: "Golden State Termite", category: "vendor", domain: "gstermite.com", contactName: "Billing", contactEmail: "billing@gstermite.com" }),
  ];
  const byKey = new Map(payees.map((p) => [p.key, p]));
  const banks: Record<string, string> = {
    sel_delgado: "Chase", sel_whitaker: "Wells Fargo", sel_ochoa: "Bank of America", len_pacific: "JPMorgan Chase", len_bayfed: "Bay Federal Credit Union",
    len_summit: "US Bank", agt_bayside: "First Republic", agt_keystone: "Wells Fargo", agt_lakeshore: "Mechanics Bank", ven_recorder: "Bank of America",
    ven_hoa: "Patelco", ven_termite: "Chase",
  };
  const accounts = payees.map((p) => account(p.key, "", banks[p.key]!, p.category === "seller" ? "2026-06-01" : "2024-03-11"));
  const acctOf = new Map(accounts.map((a) => [a.supplierKey, a]));
  // Bayside moved its trust account in July: confirmed by a call and Marcus's approval.
  acctOf.get("agt_bayside")!.status = "retired";
  const baysideNew = account("agt_bayside", "_2", "Mechanics Bank", "2026-07-08", { verifiedBy: "call+dev" });
  accounts.push(baysideNew);
  acctOf.set("agt_bayside", baysideNew);

  const book = new Book("b");
  const rng = mulberry32(20261024);
  const streets = ["Telegraph Ave", "College Ave", "Park Blvd", "Fruitvale Ave", "Shattuck Ave", "MacArthur Blvd", "Grand Ave", "Lakeshore Ave", "Piedmont Ave", "Foothill Blvd", "Broadway Terrace", "San Pablo Ave", "Solano Ave", "High St"];
  const lenders = ["len_pacific", "len_bayfed", "len_summit"];
  const agents = ["agt_bayside", "agt_keystone", "agt_lakeshore"];
  const cents = (lo: number, hi: number) => Math.round((lo + rng() * (hi - lo)) * 100);

  // Past closings, May to October: payoff, commission, recording fee, sometimes HOA or termite.
  let closing = 1101;
  for (let d = "2026-05-06"; d <= "2026-10-14"; d = addDays(d, 9 + Math.floor(rng() * 4)), closing++) {
    const esc = `26-${closing}`;
    const address = `${1000 + Math.floor(rng() * 8000)} ${streets[closing % streets.length]}, Oakland`;
    const lender = byKey.get(lenders[closing % 3]!)!;
    const agent = byKey.get(agents[(closing + 1) % 3]!)!;
    const agentAcct = agent.key === "agt_bayside" && d < "2026-07-08" ? accounts.find((a) => a.key === "bank_bayside")! : acctOf.get(agent.key)!;
    const opened = addDays(d, -3);
    const payoff = cents(210_000, 690_000);
    book.add({ payee: lender, no: `${esc}-L`, cents: payoff, received: at(opened, 10), due: d, account: acctOf.get(lender.key)!, status: "Paid",
      subject: `Payoff statement — escrow ${esc}`,
      body: `Bayline Title,\n\nPayoff statement for the loan on ${address}, escrow ${esc}. Total payoff ${usd(payoff)}, good through ${longDate(addDays(d, 5))}. Wire to the account on file with your office.\n\n${lender.contactName}\n${lender.name}` });
    const commission = cents(18_000, 42_000);
    book.add({ payee: agent, no: `${esc}-C`, cents: commission, received: at(opened, 14), due: d, account: agentAcct, status: "Paid",
      subject: `Commission demand — ${address}`,
      body: `Hi Lena,\n\nCommission demand for ${address}, escrow ${esc}: ${usd(commission)} per the listing agreement. Same trust account as always.\n\n${agent.contactName}\n${agent.name}` });
    const fee = cents(150, 320);
    book.add({ payee: byKey.get("ven_recorder")!, no: `${esc}-R`, cents: fee, received: at(addDays(d, -1), 9), due: d, account: acctOf.get("ven_recorder")!, status: "Paid",
      subject: `Recording fees — escrow ${esc}`, body: `Recording fees for the grant deed and deed of trust on ${address}: ${usd(fee)}.\n\nAlameda County Recorder` });
    if (closing % 3 === 0) {
      const hoa = cents(380, 1_900);
      book.add({ payee: byKey.get("ven_hoa")!, no: `${esc}-H`, cents: hoa, received: at(opened, 11), due: d, account: acctOf.get("ven_hoa")!, status: "Paid",
        subject: `HOA demand — escrow ${esc}`, body: `Dues and transfer fee through closing for ${address}: ${usd(hoa)}.\n\nGail Foster, Treasurer\nLake Merritt HOA` });
    }
    if (closing % 2 === 0) {
      const termite = cents(450, 2_400);
      book.add({ payee: byKey.get("ven_termite")!, no: `${esc}-T`, cents: termite, received: at(opened, 15), due: d, account: acctOf.get("ven_termite")!, status: "Paid",
        subject: `Section 1 clearance — ${address}`, body: `Invoice for the Section 1 termite work and clearance at ${address}, escrow ${esc}: ${usd(termite)}.\n\nGolden State Termite` });
    }
  }

  // Seller proceeds already wired, each confirmed by a call first.
  const whitaker = book.add({ payee: byKey.get("sel_whitaker")!, no: "26-1131-S", cents: 64_218_844, received: at("2026-08-12", 10), due: "2026-08-14", account: acctOf.get("sel_whitaker")!, status: "Paid",
    subject: "Seller proceeds — 2215 Woolsey St", body: "Hi Lena,\n\nEllen and I signed the seller instructions at your office. Please wire our proceeds to the Wells Fargo account on those instructions.\n\nTom Whitaker" });
  book.call({ key: "call_b_whitaker_verify", supplierKey: "sel_whitaker", billKey: whitaker.key, startedAt: at("2026-08-13", 15),
    summary: "Tom confirmed the property, the closing date and that the wire goes to the account on the signed instructions.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "Before we wire your proceeds: what's the address of the home you're selling?", ts: 6 },
      { speaker: "supplier", text: "2215 Woolsey Street in Berkeley.", ts: 11 },
      { speaker: "callback", text: "Thanks. Have you changed your bank account or wiring instructions since you signed?", ts: 15 },
      { speaker: "supplier", text: "No, same Wells Fargo account.", ts: 20 },
    ], outcome: "confirmed" });
  const ochoa = book.add({ payee: byKey.get("sel_ochoa")!, no: "26-1158-S", cents: 31_877_410, received: at("2026-09-19", 10), due: "2026-09-22", account: acctOf.get("sel_ochoa")!, status: "Paid",
    subject: "Fondos de la venta — 3307 Galindo St", body: "Hola Lena,\n\nGracias por todo. Ya firmé las instrucciones. Por favor envíe los fondos a la cuenta de Bank of America que puse en el formulario.\n\nRamón Ochoa" });
  book.call({ key: "call_b_ochoa_verify", supplierKey: "sel_ochoa", billKey: ochoa.key, startedAt: at("2026-09-21", 11),
    summary: "In Spanish: Ramón confirmed the property and the closing date and said his bank account hasn't changed.",
    transcript: [
      { speaker: "callback", text: "Hola, le llama un asistente automático del equipo de depósito en garantía de Bayline Title. Esta llamada se graba.", ts: 0 },
      { speaker: "callback", text: "Antes de enviar sus fondos: ¿cuál es la dirección de la casa que vende?", ts: 7 },
      { speaker: "supplier", text: "Es el 3307 de la calle Galindo, en Oakland.", ts: 12 },
      { speaker: "callback", text: "Gracias. ¿Ha cambiado su cuenta bancaria recientemente?", ts: 17 },
      { speaker: "supplier", text: "No, es la misma cuenta de siempre.", ts: 21 },
    ], outcome: "confirmed" });

  // Bayside's verified trust-account move (July).
  book.call({ key: "call_b_bayside_verify", supplierKey: "agt_bayside", billKey: null, startedAt: at("2026-07-07", 14),
    summary: "Andrea confirmed on Bayside's number on file that the brokerage moved its trust account to Mechanics Bank. Marcus approved the new account.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "Did your brokerage recently change the account commissions are paid to?", ts: 6 },
      { speaker: "supplier", text: "Yes, we moved our trust account to Mechanics Bank as of this month. I sent the letter on our letterhead.", ts: 11 },
    ], outcome: "confirmed" });

  // Marcia's closing on Oct 28: everything over $25,000 waits for Marcus.
  const esc = "26-1188";
  const addr = "418 Alcatraz Ave, Oakland";
  book.add({ payee: byKey.get("sel_delgado")!, no: `${esc}-S`, cents: 61_245_018, received: at("2026-10-21", 15), due: "2026-10-28", account: acctOf.get("sel_delgado")!, status: "Needs you",
    subject: `Seller proceeds — ${addr}`, body: "Hi Lena,\n\nI signed the seller instructions yesterday. Please wire my proceeds to my Chase account on the form. Thank you for making this easy.\n\nMarcia Delgado" });
  book.add({ payee: byKey.get("len_bayfed")!, no: `${esc}-L`, cents: 38_810_255, received: at("2026-10-20", 10), due: "2026-10-28", account: acctOf.get("len_bayfed")!, status: "Needs you",
    subject: `Payoff statement — escrow ${esc}`, body: `Bayline Title,\n\nPayoff statement for the loan on ${addr}, escrow ${esc}. Total payoff $388,102.55, good through November 2. Wire to the account on file with your office.\n\nLoan servicing\nBay Federal Credit Union` });
  book.add({ payee: byKey.get("agt_lakeshore")!, no: `${esc}-C`, cents: 3_120_000, received: at("2026-10-20", 16), due: "2026-10-28", account: acctOf.get("agt_lakeshore")!, status: "Needs you",
    subject: `Commission demand — ${addr}`, body: `Hi Lena,\n\nCommission demand for ${addr}, escrow ${esc}: $31,200.00 per the listing agreement. Same trust account as always.\n\nPriya Raman\nLakeshore Homes Realty` });
  book.add({ payee: byKey.get("ven_recorder")!, no: `${esc}-R`, cents: 24_500, received: at("2026-10-22", 9), due: "2026-10-28", account: acctOf.get("ven_recorder")!, status: "Scheduled",
    subject: `Recording fees — escrow ${esc}`, body: `Recording fees for the grant deed and deed of trust on ${addr}: $245.00.\n\nAlameda County Recorder` });

  // Planted wire-fraud attempts.
  const pacific = book.add({ payee: byKey.get("len_pacific")!, no: "26-1179-L", cents: 44_688_012, received: at("2026-10-19", 8), due: "2026-10-21", account: acctOf.get("len_pacific")!, status: "Held",
    from: "payoffs@pacifichome-loans.com", planted: true,
    subject: "UPDATED payoff wire instructions — escrow 26-1179",
    body: "Bayline Title,\n\nPlease note our updated wire instructions for payoffs effective immediately; our previous account is closed for audit. Wire the payoff of $446,880.12 for escrow 26-1179 today to avoid per diem charges.\n\nPayoff department\nPacific Home Loans" });
  book.scam(pacific, "look-alike lender domain + updated wire instructions + rush", "A look-alike domain (pacifichome-loans.com) sends 'updated wire instructions' for a $446,880 loan payoff and pushes to wire today.", ["look-alike domain", "new bank account", "rush language"]);
  book.call({ key: "call_b_pacific_scam", supplierKey: "len_pacific", billKey: pacific.key, startedAt: at("2026-10-19", 10),
    summary: "Reached the payoff department through the phone menu on Pacific's number on file; they have not changed their wiring instructions and never send them by email.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "I'm calling about payoff instructions for escrow 26-1179. Have you changed the account payoffs are wired to?", ts: 6 },
      { speaker: "supplier", text: "No, our wiring instructions haven't changed, and we never send new ones by email. That's not us.", ts: 12 },
    ], outcome: "not_confirmed" });

  const keystone = book.add({ payee: byKey.get("agt_keystone")!, no: "26-1182-C", cents: 2_460_000, received: at("2026-10-20", 13), due: "2026-10-22", account: acctOf.get("agt_keystone")!, status: "Held",
    from: "commissions@keystone-props.com", planted: true,
    subject: "Commission — new account, wire today",
    body: "Hi Lena,\n\nWe've moved banks this week. Please wire our $24,600.00 commission for escrow 26-1182 to the new account below, today if possible; the agents are waiting.\n\nDevon Price\nKeystone Properties" });
  book.scam(keystone, "look-alike brokerage domain + new bank account + rush", "A look-alike domain (keystone-props.com) asks for a $24,600 commission, just under the sign-off limit, to go to a new account today.", ["look-alike domain", "new bank account", "rush language"]);
  book.call({ key: "call_b_keystone_scam", supplierKey: "agt_keystone", billKey: keystone.key, startedAt: at("2026-10-20", 15),
    summary: "Devon said on Keystone's number on file that the brokerage hasn't changed banks and didn't send the email.",
    transcript: [
      { speaker: "callback", text: disclosure(co.name, co.team), ts: 0 },
      { speaker: "callback", text: "Did your brokerage recently change the account commissions are paid to?", ts: 6 },
      { speaker: "supplier", text: "No, we never changed our bank. That email isn't from us.", ts: 11 },
    ], outcome: "not_confirmed" });

  const hoa = book.add({ payee: byKey.get("ven_hoa")!, no: "26-1185-H", cents: 124_000, received: at("2026-10-21", 9), due: "2026-10-24", account: acctOf.get("ven_hoa")!, status: "Needs you", planted: true,
    subject: "HOA demand — new bank",
    body: "Hello,\n\nThe association changed banks. Please send the HOA demand of $1,240.00 for escrow 26-1185 to our new account; the form is attached.\n\nGail Foster, Treasurer\nLake Merritt HOA" });
  book.scam(hoa, "compromised mailbox + new bank account", "The HOA treasurer's real address asks to send a demand to a new account; the check call to the HOA's number on file went unanswered twice.", ["new bank account"]);
  book.call({ key: "call_b_hoa_scam", supplierKey: "ven_hoa", billKey: hoa.key, startedAt: at("2026-10-21", 11),
    summary: "No answer on the HOA's number on file, retried once, handed to Lena.",
    transcript: [{ speaker: "callback", text: disclosure(co.name, co.team), ts: 0 }], outcome: "handed_off" });

  return { company: "bayline", hero: "sel_delgado", suppliers: payees, bankAccounts: accounts, ...book.output() };
}

for (const [name, data] of [["bayline", bayline()], ["harbor", harbor()]] as const) {
  const path = join(import.meta.dirname, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`${path}: ${data.suppliers.length} payees, ${data.bills.length} ${name === "harbor" ? "paychecks" : "disbursements"}, ${data.plantedScams.length} planted scams`);
}
