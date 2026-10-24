// The Suppliers graph: Fogline at the centre, one hub per category, every supplier on the ring
// around them. Two kinds of link are worth a person's attention and drawn in serial red: a sender
// domain that pretended to be a supplier (look-alike), and one bank account that more than one
// supplier asked to be paid into. Pure and deterministic, so the same data draws the same graph.
import type { BankAccount, Bill, Supplier } from "./types";

export type Category = Supplier["category"];

export const CATEGORY_LABEL: Record<Category, string> = {
  stage: "Stage",
  sound: "Sound",
  security: "Security",
  agency: "Artist agencies",
  food: "Food",
  other: "Site services",
};

export interface SupplierFacts {
  supplier: Supplier;
  openItems: number;
  bills: number;
  paidCents: number;
  lastBillAt: string | null;
  /** Bills held right now: money stopped. */
  held: number;
  /** Accounts Fogline has paid into or been asked to, newest first. */
  accounts: BankAccount[];
  lookalikes: string[];
  /** Other suppliers' keys that asked for the same account. */
  sharesAccountWith: Array<{ supplierKey: string; account: string }>;
}

export type GraphNode =
  | { kind: "fogline"; id: string; x: number; y: number }
  | { kind: "category"; id: string; x: number; y: number; category: Category; count: number }
  | { kind: "supplier"; id: string; x: number; y: number; angle: number; facts: SupplierFacts }
  | { kind: "lookalike"; id: string; x: number; y: number; angle: number; domain: string; supplierKey: string };

export interface GraphEdge {
  from: string;
  to: string;
  kind: "category" | "supplier" | "lookalike" | "shared_account";
  label?: string;
}

export interface SupplierGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const RING = { category: 130, lookalike: 225, supplier: 300 };
const CATEGORY_ORDER: Category[] = ["stage", "sound", "security", "agency", "food", "other"];

const accountName = (a: BankAccount) => `${a.bank} ··${a.last4}`;

export function buildSupplierGraph(suppliers: Array<Supplier & { openItems: number }>, bills: Bill[]): SupplierGraph {
  const facts = new Map<string, SupplierFacts>();
  for (const s of suppliers) {
    facts.set(s.key, { supplier: s, openItems: s.openItems, bills: 0, paidCents: 0, lastBillAt: null, held: 0, accounts: [], lookalikes: [], sharesAccountWith: [] });
  }

  const askedBy = new Map<string, Set<string>>(); // "Mercury ··8817" -> supplier keys
  for (const b of bills) {
    const f = facts.get(b.supplier.key);
    if (!f) continue;
    f.bills++;
    if (b.status === "Paid") f.paidCents += b.amountCents;
    if (b.status === "Held") f.held++;
    if (!f.lastBillAt || b.receivedAt > f.lastBillAt) f.lastBillAt = b.receivedAt;
    const domain = b.email.fromDomain.toLowerCase();
    if (domain && domain !== f.supplier.domain.toLowerCase() && !f.lookalikes.includes(domain)) f.lookalikes.push(domain);
    // A new supplier's first bill has no account yet (key ""): nothing to show or link.
    if (!b.bankAccount.key) continue;
    if (!f.accounts.some((a) => a.key === b.bankAccount.key)) f.accounts.push(b.bankAccount);
    const name = accountName(b.bankAccount);
    askedBy.set(name, (askedBy.get(name) ?? new Set()).add(b.supplier.key));
  }

  const edges: GraphEdge[] = [];
  for (const [account, keys] of askedBy) {
    const list = [...keys].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        edges.push({ from: list[i], to: list[j], kind: "shared_account", label: account });
        facts.get(list[i])!.sharesAccountWith.push({ supplierKey: list[j], account });
        facts.get(list[j])!.sharesAccountWith.push({ supplierKey: list[i], account });
      }
    }
  }
  for (const f of facts.values()) f.accounts.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));

  // Suppliers sit on one ring, grouped by category with a one-slot gap between groups.
  const groups = CATEGORY_ORDER.map((c) => ({
    category: c,
    members: [...facts.values()].filter((f) => f.supplier.category === c).sort((a, b) => a.supplier.name.localeCompare(b.supplier.name)),
  })).filter((g) => g.members.length > 0);
  const slots = facts.size + groups.length;
  const step = (2 * Math.PI) / Math.max(slots, 1);
  const at = (r: number, angle: number) => ({ x: Math.round(r * Math.cos(angle)), y: Math.round(r * Math.sin(angle)) });

  const nodes: GraphNode[] = [{ kind: "fogline", id: "fogline", x: 0, y: 0 }];
  let slot = 0;
  for (const g of groups) {
    const first = slot;
    const catId = `cat:${g.category}`;
    for (const f of g.members) {
      const angle = slot * step - Math.PI / 2;
      nodes.push({ kind: "supplier", id: f.supplier.key, angle, ...at(RING.supplier, angle), facts: f });
      edges.push({ from: catId, to: f.supplier.key, kind: "supplier" });
      for (const domain of f.lookalikes) {
        const id = `look:${domain}`;
        nodes.push({ kind: "lookalike", id, angle, ...at(RING.lookalike, angle + step / 3), domain, supplierKey: f.supplier.key });
        edges.push({ from: id, to: f.supplier.key, kind: "lookalike", label: `pretended to be ${f.supplier.domain}` });
      }
      slot++;
    }
    const mid = ((first + slot - 1) / 2) * step - Math.PI / 2;
    nodes.push({ kind: "category", id: catId, ...at(RING.category, mid), category: g.category, count: g.members.length });
    edges.push({ from: "fogline", to: catId, kind: "category" });
    slot++; // the gap
  }
  return { nodes, edges };
}
