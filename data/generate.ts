// Deterministic seed-data generator for Fogline (the demo festival).
// Run: npx tsx data/generate.ts
// No deps: own seeded PRNG (mulberry32) so output is byte-identical on every run.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------- seeded RNG ----------
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261023); // today's date as seed, for determinism
const rnd = () => rng();
const randInt = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T,>(arr: readonly T[]): T => arr[randInt(0, arr.length - 1)];

// Separate local PRNG for deterministic "messy but legitimate" data (odd invoice
// formats, body copy missing the invoice number, casual phrasing). Never drawn
// from `rng`, so adding these never shifts any other generated field — same
// approach as keyDigits below.
const messRng = mulberry32(20261023 + 7);
const ODD_INVOICE_FORMATS: Array<(n: string) => string> = [
  (n) => `${n}-A`,
  (n) => `2026/${n}`,
  (n) => `No. ${n}`,
  (n) => `${n}.1`,
  (n) => `${n}-REV`,
  (n) => `FGL${n}`,
];
// Indices into the stream of ordinary recurring bills (not hero/legit/planted)
// that get deliberately messy-but-legitimate treatment — real invoicing is never
// this clean, and none of these should trip runChecks.
const ODD_INVOICE_INDICES: Record<number, true> = { 4: true, 18: true, 35: true, 58: true, 82: true, 109: true };
const MISSING_INVOICE_IN_BODY_INDICES: Record<number, true> = { 24: true, 96: true };
const CASUAL_QUIRK_INDICES: Record<number, true> = { 12: true, 63: true, 115: true };
let regularBillIndex = -1;

// ---------- dates ----------
const TODAY = new Date("2026-10-23T09:00:00-07:00");
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
const iso = (d: Date) => d.toISOString();
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ---------- suppliers ----------
type Category = "stage" | "sound" | "security" | "agency" | "food" | "other";
interface SupplierDef {
  key: string;
  name: string;
  category: Category;
  domain: string;
  contactName: string;
  contactEmail: string;
  phoneSuffix: string; // last 2 digits of +1415555 01xx
}

const SUPPLIERS: SupplierDef[] = [
  // stage builders (3) — sup_stage is the hero
  { key: "sup_stage", name: "Stagecraft Rigging Co.", category: "stage", domain: "stagecraftrigging.com", contactName: "Rosa Quintero", contactEmail: "rosa@stagecraftrigging.com", phoneSuffix: "00" },
  { key: "sup_bayview_staging", name: "Bayview Staging Systems", category: "stage", domain: "bayviewstaging.com", contactName: "Nate Ferris", contactEmail: "nate@bayviewstaging.com", phoneSuffix: "01" },
  { key: "sup_gg_truss", name: "Golden Gate Truss & Deck", category: "stage", domain: "ggtrussdeck.com", contactName: "Priya Shah", contactEmail: "priya@ggtrussdeck.com", phoneSuffix: "02" },

  // sound rental (3)
  { key: "sup_soundwave", name: "Soundwave Audio Rentals", category: "sound", domain: "soundwaveaudio.com", contactName: "Marcus Oyelaran", contactEmail: "marcus@soundwaveaudio.com", phoneSuffix: "03" },
  { key: "sup_pacific_pa", name: "Pacific Coast PA Co.", category: "sound", domain: "pacificcoastpa.com", contactName: "Lena Brooks", contactEmail: "lena@pacificcoastpa.com", phoneSuffix: "04" },
  { key: "sup_bassline", name: "Bass Line Audio", category: "sound", domain: "basslineaudio.com", contactName: "Theo Marsh", contactEmail: "theo@basslineaudio.com", phoneSuffix: "05" },

  // security (3)
  { key: "sup_sfbay_security", name: "SF Bay Security Services", category: "security", domain: "sfbaysecurity.com", contactName: "Carmen Diaz", contactEmail: "carmen@sfbaysecurity.com", phoneSuffix: "06" },
  { key: "sup_guardian_gate", name: "Guardian Gate Security", category: "security", domain: "guardiangatesecurity.com", contactName: "Owen Pratt", contactEmail: "owen@guardiangatesecurity.com", phoneSuffix: "07" },
  { key: "sup_perimeter_pro", name: "Perimeter Pro Staffing", category: "security", domain: "perimeterprostaffing.com", contactName: "Yusuf Dembele", contactEmail: "yusuf@perimeterprostaffing.com", phoneSuffix: "08" },

  // artist agencies (5)
  { key: "sup_horizon_artists", name: "Horizon Artist Management", category: "agency", domain: "horizonartists.com", contactName: "Grace Lindqvist", contactEmail: "grace@horizonartists.com", phoneSuffix: "09" },
  { key: "sup_cascade_talent", name: "Cascade Talent Group", category: "agency", domain: "cascadetalentgroup.com", contactName: "Diego Fuentes", contactEmail: "diego@cascadetalentgroup.com", phoneSuffix: "10" },
  { key: "sup_westline_booking", name: "Westline Booking Agency", category: "agency", domain: "westlinebooking.com", contactName: "Harriet Ngo", contactEmail: "harriet@westlinebooking.com", phoneSuffix: "11" },
  { key: "sup_nightowl_agency", name: "Night Owl Artist Agency", category: "agency", domain: "nightowlagency.com", contactName: "Samir Kapoor", contactEmail: "samir@nightowlagency.com", phoneSuffix: "12" },
  { key: "sup_redwood_artists", name: "Redwood Artist Collective", category: "agency", domain: "redwoodartists.com", contactName: "Bella Tran", contactEmail: "bella@redwoodartists.com", phoneSuffix: "13" },

  // food vendors (8)
  { key: "sup_mission_tacos", name: "Mission Street Tacos", category: "food", domain: "missionsttacos.com", contactName: "Alma Reyes", contactEmail: "alma@missionsttacos.com", phoneSuffix: "14" },
  { key: "sup_dolores_catering", name: "Dolores Park Catering", category: "food", domain: "dolorescatering.com", contactName: "Will Huang", contactEmail: "will@dolorescatering.com", phoneSuffix: "15" },
  { key: "sup_baybites", name: "Bay Bites Food Co.", category: "food", domain: "baybitesfood.com", contactName: "Kiona Mack", contactEmail: "kiona@baybitesfood.com", phoneSuffix: "16" },
  { key: "sup_sfslice", name: "SF Slice Pizza Co.", category: "food", domain: "sfslicepizza.com", contactName: "Tony Russo", contactEmail: "tony@sfslicepizza.com", phoneSuffix: "17" },
  { key: "sup_goldenhour_coffee", name: "Golden Hour Coffee Cart", category: "food", domain: "goldenhourcoffee.com", contactName: "Mei Lin Zhao", contactEmail: "meilin@goldenhourcoffee.com", phoneSuffix: "18" },
  { key: "sup_embarcadero_eats", name: "Embarcadero Eats", category: "food", domain: "embarcaderoeats.com", contactName: "Jonah Petit", contactEmail: "jonah@embarcaderoeats.com", phoneSuffix: "19" },
  { key: "sup_fogcity_ramen", name: "Fog City Ramen", category: "food", domain: "fogcityramen.com", contactName: "Haruto Sano", contactEmail: "haruto@fogcityramen.com", phoneSuffix: "20" },
  { key: "sup_sunset_bbq", name: "Sunset BBQ Co.", category: "food", domain: "sunsetbbqco.com", contactName: "Dana Okafor", contactEmail: "dana@sunsetbbqco.com", phoneSuffix: "21" },

  // other (3)
  { key: "sup_bayfront_waste", name: "Bayfront Waste & Recycling", category: "other", domain: "bayfrontwaste.com", contactName: "Ellis Moreno", contactEmail: "ellis@bayfrontwaste.com", phoneSuffix: "22" },
  { key: "sup_gg_generators", name: "Golden Gate Generators", category: "other", domain: "gggenerators.com", contactName: "Fatima Noor", contactEmail: "fatima@gggenerators.com", phoneSuffix: "23" },
  { key: "sup_sf_fence", name: "SF Fence & Barricade Co.", category: "other", domain: "sffencebarricade.com", contactName: "Rick Alvarado", contactEmail: "rick@sffencebarricade.com", phoneSuffix: "24" },
];

const trustedPhone = (s: SupplierDef) => `+141555501${s.phoneSuffix}`;
const supplierByKey = new Map(SUPPLIERS.map((s) => [s.key, s]));

// ---------- supplier "voice" (consistent email style per supplier, for Moss) ----------
const VOICES: Record<string, { greeting: string; closing: string; title: string; tone: "formal" | "brisk" | "warm" }> = {
  sup_stage: { greeting: "Hi team,", closing: "Thanks,", title: "Accounts, Stagecraft Rigging Co.", tone: "formal" },
  sup_bayview_staging: { greeting: "Hey Fogline,", closing: "Cheers,", title: "Ops, Bayview Staging Systems", tone: "brisk" },
  sup_gg_truss: { greeting: "Hello,", closing: "Best regards,", title: "Billing, Golden Gate Truss & Deck", tone: "formal" },
  sup_soundwave: { greeting: "Hi there,", closing: "Thanks much,", title: "Soundwave Audio Rentals", tone: "warm" },
  sup_pacific_pa: { greeting: "Hello Fogline team,", closing: "Regards,", title: "Pacific Coast PA Co.", tone: "formal" },
  sup_bassline: { greeting: "Hey,", closing: "— T", title: "Bass Line Audio", tone: "brisk" },
  sup_sfbay_security: { greeting: "Good afternoon,", closing: "Respectfully,", title: "SF Bay Security Services, Billing Dept.", tone: "formal" },
  sup_guardian_gate: { greeting: "Hi,", closing: "Thank you,", title: "Guardian Gate Security", tone: "formal" },
  sup_perimeter_pro: { greeting: "Hey Fogline,", closing: "Thanks!", title: "Perimeter Pro Staffing", tone: "warm" },
  sup_horizon_artists: { greeting: "Hello,", closing: "Warmly,", title: "Horizon Artist Management", tone: "warm" },
  sup_cascade_talent: { greeting: "Hi,", closing: "Best,", title: "Cascade Talent Group", tone: "brisk" },
  sup_westline_booking: { greeting: "Hello Fogline,", closing: "Kind regards,", title: "Westline Booking Agency", tone: "formal" },
  sup_nightowl_agency: { greeting: "Hey team,", closing: "— Samir", title: "Night Owl Artist Agency", tone: "brisk" },
  sup_redwood_artists: { greeting: "Hi folks,", closing: "Take care,", title: "Redwood Artist Collective", tone: "warm" },
  sup_mission_tacos: { greeting: "Hola Fogline team,", closing: "Gracias,", title: "Mission Street Tacos", tone: "warm" },
  sup_dolores_catering: { greeting: "Hi,", closing: "Best,", title: "Dolores Park Catering", tone: "brisk" },
  sup_baybites: { greeting: "Hey!", closing: "Thanks,", title: "Bay Bites Food Co.", tone: "warm" },
  sup_sfslice: { greeting: "Hi,", closing: "— Tony", title: "SF Slice Pizza Co.", tone: "brisk" },
  sup_goldenhour_coffee: { greeting: "Hi there,", closing: "Cheers,", title: "Golden Hour Coffee Cart", tone: "warm" },
  sup_embarcadero_eats: { greeting: "Hello,", closing: "Thank you,", title: "Embarcadero Eats", tone: "formal" },
  sup_fogcity_ramen: { greeting: "Hi Fogline,", closing: "Thanks,", title: "Fog City Ramen", tone: "warm" },
  sup_sunset_bbq: { greeting: "Hey team,", closing: "Best,", title: "Sunset BBQ Co.", tone: "brisk" },
  sup_bayfront_waste: { greeting: "Good day,", closing: "Regards,", title: "Bayfront Waste & Recycling, Billing", tone: "formal" },
  sup_gg_generators: { greeting: "Hi,", closing: "Thanks,", title: "Golden Gate Generators", tone: "formal" },
  sup_sf_fence: { greeting: "Hey,", closing: "Thanks,", title: "SF Fence & Barricade Co.", tone: "brisk" },
};

const itemLabel: Record<Category, string[]> = {
  stage: ["main-stage truss rental", "stage deck rental", "rigging crew labor", "monthly stage equipment lease"],
  sound: ["PA system rental", "monthly audio equipment lease", "FOH console rental", "monitor wedge rental"],
  security: ["event security staffing", "monthly guard staffing retainer", "perimeter security staffing", "overnight security shift"],
  agency: ["artist booking fee", "artist deposit", "talent agency commission", "artist travel advance"],
  food: ["vendor booth deposit", "catering services", "staff meal service", "vendor permit co-pay"],
  other: ["waste & recycling service", "generator rental", "fencing & barricade rental", "monthly equipment service"],
};

function invoiceBody(
  s: SupplierDef,
  invoiceNo: string,
  amountDollars: string,
  item: string,
  dueDate: string,
  mess?: "missing_invoice_in_body" | "casual",
): string {
  const v = VOICES[s.key];
  if (mess === "missing_invoice_in_body") {
    const lines = [
      v.greeting,
      "",
      `Attached is our invoice for ${item}, total $${amountDollars}, due ${dueDate}. Let us know if you need anything else on our end.`,
      "",
      v.closing,
      s.contactName,
      v.title,
    ];
    return lines.join("\n");
  }
  if (mess === "casual") {
    const lines = [
      "hey!",
      "",
      `invoice #${invoiceNo} is attached — ${item}, $${amountDollars}, due ${dueDate}. lemme know if anything looks off!`,
      "",
      "thx,",
      s.contactName,
    ];
    return lines.join("\n");
  }
  const lines = [
    v.greeting,
    "",
    v.tone === "brisk"
      ? `Invoice #${invoiceNo} attached — ${item}, $${amountDollars}, due ${dueDate}. Let us know if you need anything else.`
      : v.tone === "warm"
        ? `Hope prep is going well! Attached is invoice #${invoiceNo} for ${item}, total $${amountDollars}, due ${dueDate}. Thanks for working with us.`
        : `Please find attached invoice #${invoiceNo} for ${item} in the amount of $${amountDollars}, payable by ${dueDate}. Kindly remit to the account on file.`,
    "",
    v.closing,
    s.contactName,
    v.title,
  ];
  return lines.join("\n");
}

// ---------- bank accounts ----------
// routingNumber/accountNumber are pretend sandbox digits (never real routing/account numbers):
// derived deterministically from each account's own key (not the shared rng stream, so adding
// them never shifts any other generated field) so they always END WITH the existing
// routingLast4/last4 the rest of the app already displays.
function keyDigits(seed: string, n: number): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const local = mulberry32(h || 1);
  let out = "";
  for (let i = 0; i < n; i++) out += Math.floor(local() * 10);
  return out;
}
const fakeRoutingNumber = (key: string, routingLast4: string) => `${keyDigits(`${key}:routing`, 5)}${routingLast4}`;
const fakeAccountNumber = (key: string, last4: string) => `${keyDigits(`${key}:account`, 6)}${last4}`;

interface BankAccount {
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
const BANKS = ["Chase", "Bank of America", "Wells Fargo", "Mercury", "First Republic", "Silicon Valley Bank", "US Bank"];

const bankAccounts: BankAccount[] = [];
const primaryBankKeyFor = new Map<string, string>();

for (const s of SUPPLIERS) {
  const key = `bank_${s.key.replace("sup_", "")}`;
  let bank = pick(BANKS);
  let last4 = String(randInt(1000, 9999)).slice(0, 4);
  // hero: pinned exactly as specced
  if (s.key === "sup_stage") {
    bank = "Chase";
    last4 = "2210";
  }
  const routingLast4 = String(randInt(1000, 9999));
  const acct: BankAccount = {
    key,
    supplierKey: s.key,
    bank,
    last4,
    routingLast4,
    routingNumber: fakeRoutingNumber(key, routingLast4),
    accountNumber: fakeAccountNumber(key, last4),
    status: "active",
    verifiedBy: "onboarding",
    addedAt: isoDate(new Date("2024-11-05T10:00:00-08:00")),
  };
  bankAccounts.push(acct);
  primaryBankKeyFor.set(s.key, key);
}

// Legit, dev+call-verified bank changes (so "wrongly held" can be measured).
// sup_perimeter_pro and sup_horizon_artists switched banks for real business
// reasons; Maya/Dev verified both with a call + Dev sign-off.
function addVerifiedBankChange(supplierKey: string, newBank: string, newLast4: string, addedAt: string) {
  const old = bankAccounts.find((b) => b.supplierKey === supplierKey && b.status === "active")!;
  old.status = "retired";
  const key = `bank_${supplierKey.replace("sup_", "")}_2`;
  const routingLast4 = String(randInt(1000, 9999));
  bankAccounts.push({
    key,
    supplierKey,
    bank: newBank,
    last4: newLast4,
    routingLast4,
    routingNumber: fakeRoutingNumber(key, routingLast4),
    accountNumber: fakeAccountNumber(key, newLast4),
    status: "active",
    verifiedBy: "call+dev",
    addedAt,
  });
  primaryBankKeyFor.set(supplierKey, key);
  return key;
}

// ---------- bills / emails / payments ----------
interface Bill {
  key: string;
  supplierKey: string;
  invoiceNo: string;
  amountCents: number;
  currency: "USD";
  dueDate: string;
  receivedAt: string;
  bankAccountKey: string;
  status: "Paid" | "Scheduled" | "Checking" | "Calling" | "Held" | "Needs you";
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
  direction: "in" | "out";
}
interface Payment {
  key: string;
  billKey: string;
  amountCents: number;
  bankAccountKey: string;
  status: string;
  transferId?: string;
  paidAt: string;
}
interface Call {
  key: string;
  supplierKey: string;
  billKey: string | null;
  direction: "in" | "out";
  startedAt: string;
  summary: string;
  transcript: { speaker: "callback" | "supplier"; text: string; ts: number }[];
  outcome: "confirmed" | "not_confirmed" | "handed_off";
}
interface PlantedScam {
  key: string;
  billKey: string;
  kind: string;
  description: string;
  checksThatShouldFire: string[];
}

const bills: Bill[] = [];
const emails: Email[] = [];
const payments: Payment[] = [];
const calls: Call[] = [];
const plantedScams: PlantedScam[] = [];

let invoiceCounter = 4000;
function nextInvoiceNo(): string {
  invoiceCounter += 1;
  if (invoiceCounter === 4471) invoiceCounter += 1; // 4471 reserved for the hero bill
  return String(invoiceCounter);
}

const AMOUNT_RANGE_CENTS: Record<Category, [number, number]> = {
  stage: [180000, 950000], // $1.8k-$9.5k
  sound: [120000, 780000],
  security: [90000, 620000],
  agency: [250000, 1150000], // a few of these cross $10k -> Needs you (boss)
  food: [25000, 320000],
  other: [15000, 410000],
};

let transferSeq = 10000;
function nextTransferId(): string {
  transferSeq += 1;
  return `transfer_${transferSeq}`;
}

function makeRecurringBills(
  s: SupplierDef,
  count: number,
  opts?: { firstMonthsAgo?: number; amountOverride?: [number, number] },
) {
  const firstMonthsAgo = opts?.firstMonthsAgo ?? 6;
  const startMonthStart = addDays(TODAY, -firstMonthsAgo * 30);
  const spacingDays = Math.floor((firstMonthsAgo * 30) / count);
  for (let i = 0; i < count; i++) {
    const receivedAt = addDays(startMonthStart, i * spacingDays + randInt(0, Math.max(1, spacingDays - 2)));
    if (receivedAt > TODAY) continue;
    const due = addDays(receivedAt, 21);
    const [lo, hi] = opts?.amountOverride ?? AMOUNT_RANGE_CENTS[s.category];
    const amountCents = randInt(lo, hi);
    const rawInvoiceNo = nextInvoiceNo();
    const billKey = `bill_${rawInvoiceNo}`;
    const item = pick(itemLabel[s.category]);
    const amountDollars = (amountCents / 100).toFixed(2);
    const bankKey = primaryBankKeyFor.get(s.key)!;

    regularBillIndex++;
    const invoiceNo = ODD_INVOICE_INDICES[regularBillIndex]
      ? ODD_INVOICE_FORMATS[Math.floor(messRng() * ODD_INVOICE_FORMATS.length)](rawInvoiceNo)
      : rawInvoiceNo;
    const bodyMess = MISSING_INVOICE_IN_BODY_INDICES[regularBillIndex]
      ? "missing_invoice_in_body"
      : CASUAL_QUIRK_INDICES[regularBillIndex]
        ? "casual"
        : undefined;

    // last week's worth of bills ride as "Scheduled"; everything older is Paid.
    const daysUntilDue = Math.round((due.getTime() - TODAY.getTime()) / 86400000);
    const isUpcoming = receivedAt > addDays(TODAY, -7) && due >= TODAY;
    const overBoss = amountCents > 1000000; // > $10,000 needs Dev
    const status: Bill["status"] = isUpcoming ? "Scheduled" : overBoss ? "Needs you" : "Paid";

    const emailKey = `email_${billKey.replace("bill_", "")}`;
    emails.push({
      key: emailKey,
      billKey,
      fromAddress: s.contactEmail,
      fromDomain: s.domain,
      subject: `Invoice #${invoiceNo} — ${item}`,
      body: invoiceBody(s, invoiceNo, amountDollars, item, isoDate(due), bodyMess),
      receivedAt: iso(receivedAt),
      direction: "in",
    });

    bills.push({
      key: billKey,
      supplierKey: s.key,
      invoiceNo,
      amountCents,
      currency: "USD",
      dueDate: isoDate(due),
      receivedAt: iso(receivedAt),
      bankAccountKey: bankKey,
      status,
      emailKey,
      planted: false,
    });

    if (status === "Paid") {
      const paidAt = addDays(due, -randInt(0, 5));
      payments.push({
        key: `pay_${rawInvoiceNo}`,
        billKey,
        amountCents,
        bankAccountKey: bankKey,
        status: "Paid",
        transferId: nextTransferId(),
        paidAt: iso(paidAt),
      });
    } else if (status === "Scheduled") {
      payments.push({
        key: `pay_${rawInvoiceNo}`,
        billKey,
        amountCents,
        bankAccountKey: bankKey,
        status: "Scheduled",
        paidAt: iso(addDays(TODAY, randInt(1, 4))),
      });
    }
    void daysUntilDue;
  }
}

// --- regular suppliers: recurring boring bills ---
makeRecurringBills(supplierByKey.get("sup_bayview_staging")!, 6);
makeRecurringBills(supplierByKey.get("sup_gg_truss")!, 6);
makeRecurringBills(supplierByKey.get("sup_soundwave")!, 7);
makeRecurringBills(supplierByKey.get("sup_pacific_pa")!, 7);
makeRecurringBills(supplierByKey.get("sup_bassline")!, 7);
makeRecurringBills(supplierByKey.get("sup_sfbay_security")!, 6);
makeRecurringBills(supplierByKey.get("sup_guardian_gate")!, 6);
makeRecurringBills(supplierByKey.get("sup_perimeter_pro")!, 6);
makeRecurringBills(supplierByKey.get("sup_horizon_artists")!, 4);
makeRecurringBills(supplierByKey.get("sup_cascade_talent")!, 4);
makeRecurringBills(supplierByKey.get("sup_westline_booking")!, 4);
makeRecurringBills(supplierByKey.get("sup_nightowl_agency")!, 4);
makeRecurringBills(supplierByKey.get("sup_redwood_artists")!, 4);
makeRecurringBills(supplierByKey.get("sup_mission_tacos")!, 5);
makeRecurringBills(supplierByKey.get("sup_dolores_catering")!, 5);
makeRecurringBills(supplierByKey.get("sup_baybites")!, 5);
makeRecurringBills(supplierByKey.get("sup_sfslice")!, 5);
makeRecurringBills(supplierByKey.get("sup_goldenhour_coffee")!, 5);
makeRecurringBills(supplierByKey.get("sup_embarcadero_eats")!, 5);
makeRecurringBills(supplierByKey.get("sup_fogcity_ramen")!, 5);
makeRecurringBills(supplierByKey.get("sup_sunset_bbq")!, 5);
makeRecurringBills(supplierByKey.get("sup_bayfront_waste")!, 6);
makeRecurringBills(supplierByKey.get("sup_gg_generators")!, 6);
makeRecurringBills(supplierByKey.get("sup_sf_fence")!, 6);

// --- hero: Stagecraft Rigging Co., 11 bills since April, all Paid to Chase ..2210 ---
{
  const s = supplierByKey.get("sup_stage")!;
  const bankKey = primaryBankKeyFor.get(s.key)!;
  const HERO_MONTHS_AGO = 6.3; // "since April"
  const n = 11;
  const start = addDays(TODAY, -HERO_MONTHS_AGO * 30);
  const spacing = Math.floor((HERO_MONTHS_AGO * 30) / n);
  let septInvoiceDone = false;
  for (let i = 0; i < n; i++) {
    const receivedAt = addDays(start, i * spacing + randInt(0, 3));
    if (receivedAt > TODAY) continue;
    const isSeptember = !septInvoiceDone && receivedAt.getUTCMonth() === 8; // Sept = index 8
    const invoiceNo = isSeptember ? "4471" : nextInvoiceNo();
    const item = isSeptember ? "main-stage truss rental" : pick(itemLabel.stage);
    const amountCents = isSeptember ? 1840000 : randInt(180000, 950000);
    const due = addDays(receivedAt, 21);
    const amountDollars = (amountCents / 100).toFixed(2);
    const billKey = `bill_${invoiceNo}`;
    const emailKey = `email_${invoiceNo}`;

    emails.push({
      key: emailKey,
      billKey,
      fromAddress: s.contactEmail,
      fromDomain: s.domain,
      subject: `Invoice #${invoiceNo} — ${item}`,
      body: invoiceBody(s, invoiceNo, amountDollars, item, isoDate(due)),
      receivedAt: iso(receivedAt),
      direction: "in",
    });

    bills.push({
      key: billKey,
      supplierKey: s.key,
      invoiceNo,
      amountCents,
      currency: "USD",
      dueDate: isoDate(due),
      receivedAt: iso(receivedAt),
      bankAccountKey: bankKey,
      status: "Paid",
      emailKey,
      planted: false,
    });

    const paidAt = addDays(due, -randInt(1, 6));
    payments.push({
      key: `pay_${invoiceNo}`,
      billKey,
      amountCents,
      bankAccountKey: bankKey,
      status: "Paid",
      transferId: nextTransferId(),
      paidAt: iso(paidAt),
    });

    if (isSeptember) {
      septInvoiceDone = true;
      // Past verification call that mentions invoice #4471 — the amount was
      // above Stagecraft's usual range, so Callback confirmed it by phone
      // before Dev signed off and it was paid.
      calls.push({
        key: "call_4471_verify",
        supplierKey: s.key,
        billKey,
        direction: "out",
        startedAt: iso(addDays(receivedAt, 2)),
        summary: "Confirmed total and scope on September invoice #4471 (main-stage truss) before payment; supplier verified, Dev approved.",
        transcript: [
          { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team. This call is recorded. Can you confirm the total on your September invoice, number 4471?", ts: 0 },
          { speaker: "supplier", text: "Yes, that's invoice 4471 for the main-stage truss build, total is $18,400.", ts: 6 },
          { speaker: "callback", text: "Thanks. Have you changed your bank account recently?", ts: 13 },
          { speaker: "supplier", text: "No, same bank account we've always used.", ts: 18 },
        ],
        outcome: "confirmed",
      });
    }
    void amountDollars;
  }
}

// --- a few extra non-bill correspondence emails for the hero, to push past 14 ---
{
  const s = supplierByKey.get("sup_stage")!;
  const v = VOICES[s.key];
  const extras = [
    { subject: "Re: load-in schedule", body: `${v.greeting}\n\nConfirming our crew arrives 6am Thursday for load-in. Let us know if the gate code changes.\n\n${v.closing}\n${s.contactName}\n${v.title}`, daysAgo: 150 },
    { subject: "Truss inspection certificate", body: `${v.greeting}\n\nAttached is this season's truss inspection certificate for your records, as requested.\n\n${v.closing}\n${s.contactName}\n${v.title}`, daysAgo: 95 },
    { subject: "Re: main-stage layout sign-off", body: `${v.greeting}\n\nLayout looks good on our end, we'll build to the drawing you sent over.\n\n${v.closing}\n${s.contactName}\n${v.title}`, daysAgo: 40 },
  ];
  for (const [i, e] of extras.entries()) {
    emails.push({
      key: `email_stage_extra_${i + 1}`,
      billKey: null,
      fromAddress: s.contactEmail,
      fromDomain: s.domain,
      subject: e.subject,
      body: e.body,
      receivedAt: iso(addDays(TODAY, -e.daysAgo)),
      direction: "in",
    });
  }
}

// ---------- planted scams (seeded, NOT the live demo scam) ----------

// S1: look-alike domain targeting Golden Gate Truss & Deck, new bank account, rush language.
{
  const s = supplierByKey.get("sup_gg_truss")!;
  const scamDomain = "gg-trussdeck.com";
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 410000;
  const receivedAt = addDays(TODAY, -3);
  const due = addDays(receivedAt, 2);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: `priya@${scamDomain}`,
    fromDomain: scamDomain,
    subject: "URGENT: Updated remittance details — Invoice #" + invoiceNo,
    body: `Hi,\n\nWe've switched banks this week ahead of a merger and need this invoice paid to our new account ASAP, before the close of business today if possible.\n\nInvoice #${invoiceNo} — stage deck rental, $4,100.00, due ${isoDate(due)}.\nNew account: Mercury, routing on request.\n\nPlease confirm once sent.\n\nBest regards,\nPriya Shah\nBilling, Golden Gate Truss & Deck`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: primaryBankKeyFor.get(s.key)!, // still the real, on-file account — the new one was never added
    status: "Held",
    emailKey,
    planted: true,
  });
  calls.push({
    key: "call_ggtruss_scam",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 0.2)),
    summary: "Called the real number on file to confirm the bank-change request on invoice " + invoiceNo + "; supplier said they never sent it and never changed banks.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team, about an email we received asking to change your payment account. This call is recorded.", ts: 0 },
      { speaker: "supplier", text: "We didn't send that. We've never changed our bank, and that's not even our email domain.", ts: 9 },
    ],
    outcome: "not_confirmed",
  });
  plantedScams.push({
    key: "scam_ggtruss_lookalike",
    billKey,
    kind: "look-alike domain + new bank account + rush language",
    description: `Email claims to be from Golden Gate Truss & Deck but arrives from gg-trussdeck.com (real domain is ggtrussdeck.com), asks for payment to a brand-new Mercury account, and pushes a same-day deadline.`,
    checksThatShouldFire: ["look-alike domain", "new bank account", "rush language"],
  });
}

// S2: new bank account from Fog City Ramen's *real* domain (hacked-account style), handed off (no answer).
{
  const s = supplierByKey.get("sup_fogcity_ramen")!;
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 68000;
  const receivedAt = addDays(TODAY, -5);
  const due = addDays(receivedAt, 10);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: s.contactEmail,
    fromDomain: s.domain,
    subject: `Invoice #${invoiceNo} — updated bank details`,
    body: `Hi Fogline,\n\nQuick note: we switched to a new bank this month, please use the new account below for invoice #${invoiceNo} (staff meal service, $680.00, due ${isoDate(due)}).\n\nNew bank: Mercury, acct ending 8832.\n\nThanks,\nHaruto Sano\nFog City Ramen`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: primaryBankKeyFor.get(s.key)!,
    status: "Needs you",
    emailKey,
    planted: true,
  });
  calls.push({
    key: "call_fogcity_scam",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 0.3)),
    summary: "Tried the number on file to confirm the bank-change request; no answer, retried once, handed off to Maya.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team, about a bank-change request on invoice " + invoiceNo + ". This call is recorded.", ts: 0 },
    ],
    outcome: "handed_off",
  });
  plantedScams.push({
    key: "scam_fogcity_newbank",
    billKey,
    kind: "new bank account from a compromised real address",
    description: `Fog City Ramen's real address asks to redirect payment to a brand-new Mercury account never seen before; verification call went unanswered twice.`,
    checksThatShouldFire: ["new bank account", "no prior history with this account"],
  });
}

// S3: unusual amount + rush language on Guardian Gate Security, same real address/bank.
{
  const s = supplierByKey.get("sup_guardian_gate")!;
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 4700000; // way above their usual $900-$6.2k range
  const receivedAt = addDays(TODAY, -2);
  const due = addDays(receivedAt, 1);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: s.contactEmail,
    fromDomain: s.domain,
    subject: `URGENT — Invoice #${invoiceNo}, pay today`,
    body: `Hi,\n\nWe need this settled today — invoice #${invoiceNo} for additional overnight staffing, $47,000.00, due ${isoDate(due)}. Please expedite.\n\nThank you,\nOwen Pratt\nGuardian Gate Security`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: primaryBankKeyFor.get(s.key)!,
    status: "Held",
    emailKey,
    planted: true,
  });
  calls.push({
    key: "call_guardiangate_scam",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 0.2)),
    summary: "Called to confirm an invoice 8x this supplier's usual size; supplier had no record of it.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team about invoice " + invoiceNo + " for $47,000. This call is recorded. Can you confirm this invoice?", ts: 0 },
      { speaker: "supplier", text: "$47,000? No, we didn't send anything close to that this week. Let me check with billing and call you back.", ts: 8 },
    ],
    outcome: "not_confirmed",
  });
  plantedScams.push({
    key: "scam_guardiangate_amount",
    billKey,
    kind: "unusual amount + rush language",
    description: `Invoice for $47,000 is roughly 8x Guardian Gate Security's typical bill, arrives with same-day urgency; the supplier could not confirm it when called.`,
    checksThatShouldFire: ["unusual amount", "rush language"],
  });
}

// S4: rush language + new bank on Cascade Talent Group (agency), Held.
{
  const s = supplierByKey.get("sup_cascade_talent")!;
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 540000;
  const receivedAt = addDays(TODAY, -1);
  const due = addDays(receivedAt, 1);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: s.contactEmail,
    fromDomain: s.domain,
    subject: `Invoice #${invoiceNo} — pay before the show, new account`,
    body: `Hi,\n\nOur artist's manager needs this paid before tomorrow's set or they're pulling out — invoice #${invoiceNo}, artist deposit, $5,400.00. Please use our new account, we moved banks last week: First Republic, acct ending 7743.\n\nBest,\nDiego Fuentes\nCascade Talent Group`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: primaryBankKeyFor.get(s.key)!,
    status: "Held",
    emailKey,
    planted: true,
  });
  plantedScams.push({
    key: "scam_cascade_rush",
    billKey,
    kind: "rush language + new bank account",
    description: `Threatens the artist will "pull out" unless paid within a day, and asks for a brand-new First Republic account never used before.`,
    checksThatShouldFire: ["rush language", "new bank account"],
  });
}

// S5: look-alike domain on Bayfront Waste & Recycling, Needs you (handed off).
{
  const s = supplierByKey.get("sup_bayfront_waste")!;
  const scamDomain = "bayfront-waste.co";
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 215000;
  const receivedAt = addDays(TODAY, -6);
  const due = addDays(receivedAt, 14);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: `ellis@${scamDomain}`,
    fromDomain: scamDomain,
    subject: `Invoice #${invoiceNo} — new remittance account`,
    body: `Good day,\n\nPlease note our updated account for invoice #${invoiceNo}, waste & recycling service, $2,150.00, due ${isoDate(due)}: Mercury, acct ending 9014.\n\nRegards,\nEllis Moreno\nBayfront Waste & Recycling, Billing`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: primaryBankKeyFor.get(s.key)!,
    status: "Needs you",
    emailKey,
    planted: true,
  });
  calls.push({
    key: "call_bayfront_scam",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 0.4)),
    summary: "Called the number on file about the bank-change request; supplier confirmed it wasn't theirs, flagged a look-alike domain, handed to Maya to block the sender.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team about a bank-change request on invoice " + invoiceNo + ". This call is recorded.", ts: 0 },
      { speaker: "supplier", text: "That's not from us — our domain is bayfrontwaste.com, no hyphen, no .co. Please don't pay that.", ts: 7 },
    ],
    outcome: "handed_off",
  });
  plantedScams.push({
    key: "scam_bayfront_lookalike",
    billKey,
    kind: "look-alike domain + new bank account",
    description: `Arrives from bayfront-waste.co (real domain is bayfrontwaste.com, no hyphen, .com not .co) requesting a new Mercury account.`,
    checksThatShouldFire: ["look-alike domain", "new bank account"],
  });
}

// ---------- legit, verified bank changes (false-positive guard) ----------
// Perimeter Pro Staffing: real bank change (new ownership), verified by call + Dev.
{
  const s = supplierByKey.get("sup_perimeter_pro")!;
  const receivedAt = addDays(TODAY, -45);
  const newBankKey = addVerifiedBankChange(s.key, "US Bank", "5509", isoDate(addDays(receivedAt, -2)));
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 410000;
  const due = addDays(receivedAt, 21);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: s.contactEmail,
    fromDomain: s.domain,
    subject: `Invoice #${invoiceNo} — new bank on file after ownership change`,
    body: `Hey Fogline,\n\nAs mentioned last month, we were acquired by a regional security group and moved to US Bank, ending 5509. Invoice #${invoiceNo} for monthly guard staffing retainer, $4,100.00, due ${isoDate(due)}, should route there going forward.\n\nThanks!\nYusuf Dembele\nPerimeter Pro Staffing`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  calls.push({
    key: "call_perimeterpro_verify",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 1)),
    summary: "Verified the new US Bank account after Perimeter Pro's ownership change; supplier confirmed details, Dev approved the change.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team to confirm a bank-change request. This call is recorded. Can you confirm the new account details?", ts: 0 },
      { speaker: "supplier", text: "Yes, we were acquired last month and moved everything to US Bank, account ending 5509.", ts: 7 },
    ],
    outcome: "confirmed",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: newBankKey,
    status: "Paid",
    emailKey,
    planted: false,
  });
  payments.push({
    key: `pay_${invoiceNo}`,
    billKey,
    amountCents,
    bankAccountKey: newBankKey,
    status: "Paid",
    transferId: nextTransferId(),
    paidAt: iso(addDays(due, -3)),
  });
}

// Horizon Artist Management: real bank change (switched banks), verified by call + Dev.
{
  const s = supplierByKey.get("sup_horizon_artists")!;
  const receivedAt = addDays(TODAY, -70);
  const newBankKey = addVerifiedBankChange(s.key, "Bank of America", "6621", isoDate(addDays(receivedAt, -3)));
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 680000;
  const due = addDays(receivedAt, 21);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: s.contactEmail,
    fromDomain: s.domain,
    subject: `Invoice #${invoiceNo} — switched banks this quarter`,
    body: `Hello,\n\nWe moved our operating account to Bank of America this quarter, ending 6621. Invoice #${invoiceNo} for artist booking fee, $6,800.00, due ${isoDate(due)}, should route there going forward.\n\nWarmly,\nGrace Lindqvist\nHorizon Artist Management`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  calls.push({
    key: "call_horizon_verify",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 1)),
    summary: "Verified Horizon's new Bank of America account by phone before Dev approved the change.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team to confirm a bank-change request. This call is recorded.", ts: 0 },
      { speaker: "supplier", text: "Yes, that's right, we moved to Bank of America this quarter, ending 6621.", ts: 6 },
    ],
    outcome: "confirmed",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: newBankKey,
    status: "Paid",
    emailKey,
    planted: false,
  });
  payments.push({
    key: `pay_${invoiceNo}`,
    billKey,
    amountCents,
    bankAccountKey: newBankKey,
    status: "Paid",
    transferId: nextTransferId(),
    paidAt: iso(addDays(due, -2)),
  });
}

// SF Fence & Barricade Co.: real bank change (switched to a business bank account), verified by call + Dev.
{
  const s = supplierByKey.get("sup_sf_fence")!;
  const receivedAt = addDays(TODAY, -30);
  const newBankKey = addVerifiedBankChange(s.key, "Silicon Valley Bank", "3384", isoDate(addDays(receivedAt, -1)));
  const invoiceNo = nextInvoiceNo();
  const billKey = `bill_${invoiceNo}`;
  const emailKey = `email_${invoiceNo}`;
  const amountCents = 215000;
  const due = addDays(receivedAt, 21);
  emails.push({
    key: emailKey,
    billKey,
    fromAddress: s.contactEmail,
    fromDomain: s.domain,
    subject: `Invoice #${invoiceNo} — new business account on file`,
    body: `Hey,\n\nJust a heads up, we opened a business account at Silicon Valley Bank, ending 3384, and moved payouts there. Invoice #${invoiceNo} for fencing & barricade rental, $2,150.00, due ${isoDate(due)}, should route there going forward.\n\nThanks,\nRick Alvarado\nSF Fence & Barricade Co.`,
    receivedAt: iso(receivedAt),
    direction: "in",
  });
  calls.push({
    key: "call_sffence_verify",
    supplierKey: s.key,
    billKey,
    direction: "out",
    startedAt: iso(addDays(receivedAt, 1)),
    summary: "Verified SF Fence's new Silicon Valley Bank account by phone before Dev approved the change.",
    transcript: [
      { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team to confirm a bank-change request. This call is recorded.", ts: 0 },
      { speaker: "supplier", text: "Yep, that's us — we opened a new business account at SVB, ending 3384.", ts: 5 },
    ],
    outcome: "confirmed",
  });
  bills.push({
    key: billKey,
    supplierKey: s.key,
    invoiceNo,
    amountCents,
    currency: "USD",
    dueDate: isoDate(due),
    receivedAt: iso(receivedAt),
    bankAccountKey: newBankKey,
    status: "Paid",
    emailKey,
    planted: false,
  });
  payments.push({
    key: `pay_${invoiceNo}`,
    billKey,
    amountCents,
    bankAccountKey: newBankKey,
    status: "Paid",
    transferId: nextTransferId(),
    paidAt: iso(addDays(due, -1)),
  });
}

// ---------- a few more past completed calls (non-scam), so the Suppliers/calls
// surface isn't empty for ordinary suppliers ----------
{
  const s = supplierByKey.get("sup_soundwave")!;
  const bill = bills.find((b) => b.supplierKey === s.key);
  if (bill) {
    calls.push({
      key: "call_soundwave_routine",
      supplierKey: s.key,
      billKey: bill.key,
      direction: "out",
      startedAt: iso(addDays(new Date(bill.receivedAt), 1)),
      summary: "Routine confirmation call ahead of a slightly late payment; supplier confirmed invoice details.",
      transcript: [
        { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team to confirm invoice #" + bill.invoiceNo + " before payment. This call is recorded.", ts: 0 },
        { speaker: "supplier", text: "Yep, that's correct, total and account look right on our end.", ts: 5 },
      ],
      outcome: "confirmed",
    });
  }
}
{
  const s = supplierByKey.get("sup_sfbay_security")!;
  const bill = bills.find((b) => b.supplierKey === s.key);
  if (bill) {
    calls.push({
      key: "call_sfbay_routine",
      supplierKey: s.key,
      billKey: bill.key,
      direction: "out",
      startedAt: iso(addDays(new Date(bill.receivedAt), 1)),
      summary: "Routine confirmation call on a staffing invoice ahead of payment.",
      transcript: [
        { speaker: "callback", text: "Hi, this is an automated assistant calling for Fogline's accounts team to confirm invoice #" + bill.invoiceNo + ". This call is recorded.", ts: 0 },
        { speaker: "supplier", text: "Confirmed, that's our invoice, totals match.", ts: 4 },
      ],
      outcome: "confirmed",
    });
  }
}

// ---------- the scammer's second front (answer key: data/planted-scams.md) ----------
// A new supplier Maya onboarded last week whose account on file is the same Mercury ..8817 the
// live demo scam asks for. Its first bill is small and passes every check, so it's Scheduled for
// Friday; only the Stagecraft check call exposes it. Fixed values, no rng, so nothing above shifts.
const COASTLINE = {
  key: "sup_coastline",
  name: "Coastline Staging Supply",
  category: "stage" as Category,
  domain: "coastlinestaging.com",
  contactName: "Jamie Holt",
  contactEmail: "jamie@coastlinestaging.com",
  trustedPhone: "+14155550125",
  phoneLastCheckedAt: "2026-10-16",
  status: "new" as const,
  onboarding: {
    source: "manual" as const,
    emailPhones: [],
    note: {
      hiredFor: "Extra crowd barriers and stage skirting for the second stage",
      agreed: "$4,600 flat, half on delivery",
      dates: "Delivery Oct 28, pickup Nov 9",
      foglineContact: "Maya Lin",
    },
    confirmedBy: "maya" as const,
    confirmedAt: "2026-10-16T17:20:00.000Z",
  },
};
{
  const bankKey = "bank_coastline";
  bankAccounts.push({
    key: bankKey,
    supplierKey: COASTLINE.key,
    bank: "Mercury",
    last4: "8817",
    routingLast4: "0417",
    routingNumber: fakeRoutingNumber(bankKey, "0417"),
    accountNumber: fakeAccountNumber(bankKey, "8817"),
    status: "active",
    verifiedBy: "onboarding",
    addedAt: "2026-10-16",
  });
  emails.push({
    key: "email_cs1042",
    billKey: "bill_cs1042",
    fromAddress: COASTLINE.contactEmail,
    fromDomain: COASTLINE.domain,
    subject: "Invoice #CS-1042 — barriers and stage skirting",
    body: `Hi Maya,\n\nThanks again for bringing us on for the festival. Attached is invoice #CS-1042 for crowd barriers and stage skirting, $4,600.00, due 2026-10-30.\n\nPlease remit to Mercury, account ending 8817.\n\nBest,\nJamie Holt\nCoastline Staging Supply`,
    receivedAt: "2026-10-20T18:05:00.000Z",
    direction: "in",
  });
  bills.push({
    key: "bill_cs1042",
    supplierKey: COASTLINE.key,
    invoiceNo: "CS-1042",
    amountCents: 460000,
    currency: "USD",
    dueDate: "2026-10-30",
    receivedAt: "2026-10-20T18:05:00.000Z",
    bankAccountKey: bankKey,
    status: "Scheduled",
    emailKey: "email_cs1042",
    planted: true,
  });
}

// ---------- write output ----------
const out = {
  suppliers: [
    ...SUPPLIERS.map((s) => ({
      key: s.key,
      name: s.name,
      category: s.category,
      domain: s.domain,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      trustedPhone: trustedPhone(s),
      phoneLastCheckedAt: isoDate(addDays(TODAY, -randInt(10, 60))),
    })),
    COASTLINE,
  ],
  bankAccounts,
  bills,
  emails,
  payments,
  calls,
  plantedScams,
};

const outPath = join(import.meta.dirname, "fogline.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

// eslint-disable-next-line no-console
console.log(
  `wrote ${outPath}: ${out.suppliers.length} suppliers, ${out.bills.length} bills, ${out.emails.length} emails, ${out.payments.length} payments, ${out.calls.length} calls, ${out.plantedScams.length} planted scams`,
);
