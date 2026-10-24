// Test doubles for the call layer: a scripted LLM, an in-memory Moss, and Fogline-like fixtures.
import type { CallRequest, SupplierProfile, SupplierRecord } from "../../../shared/contract.js";
import type { SearchHit, SupplierSearch } from "../../../shared/search.js";
import type { LLM, LLMRequest } from "./llm.js";
import type { z } from "zod";

type Reply<T> = T | Error | ((req: LLMRequest) => T | Error);

/** Routes each request by a substring of its system prompt to a canned reply. Unrouted requests throw. */
export class FakeLLM implements LLM {
  readonly jsonCalls: LLMRequest[] = [];
  readonly streamCalls: LLMRequest[] = [];

  constructor(
    private readonly routes: {
      json?: Record<string, Reply<unknown>>;
      stream?: Record<string, Reply<string>>;
    } = {},
  ) {}

  async json<T>(req: LLMRequest & { schema: z.ZodType<T> }): Promise<T> {
    this.jsonCalls.push(req);
    assertApiShape(req);
    const out = resolve(this.routes.json, req);
    if (out instanceof Error) throw out;
    return req.schema.parse(out);
  }

  async *streamText(req: LLMRequest): AsyncIterable<string> {
    this.streamCalls.push(req);
    assertApiShape(req);
    const out = resolve(this.routes.stream, req);
    if (out instanceof Error) throw out;
    // Token-ish chunks, so sentence re-chunking is exercised.
    for (const chunk of String(out).match(/\S+\s*/g) ?? []) yield chunk;
  }
}

/** The real API rejects these with a 400 ("does not support assistant message prefill"). */
function assertApiShape(req: LLMRequest): void {
  if (req.messages.at(-1)?.role !== "user") throw new Error("FakeLLM: conversation must end with a user message");
}

function resolve<T>(routes: Record<string, Reply<T>> | undefined, req: LLMRequest): T | Error {
  for (const [needle, reply] of Object.entries(routes ?? {})) {
    if (req.system.includes(needle)) return typeof reply === "function" ? (reply as (r: LLMRequest) => T | Error)(req) : reply;
  }
  return new Error(`FakeLLM: no route for system prompt "${req.system.slice(0, 60)}..."`);
}

export class FakeSearch implements SupplierSearch {
  readonly warmed: string[] = [];
  constructor(private readonly records: SupplierRecord[]) {}
  async warm(supplier_id: string): Promise<void> {
    this.warmed.push(supplier_id);
  }
  async search(supplier_id: string, _query: string, opts?: { topK?: number; kinds?: SupplierRecord["kind"][] }): Promise<SearchHit[]> {
    return this.records
      .filter((r) => r.supplier_id === supplier_id && (!opts?.kinds || opts.kinds.includes(r.kind)))
      .slice(0, opts?.topK ?? 10)
      .map((record, i) => ({ record, score: 1 - i / 100 }));
  }
  readonly indexed: { supplier_id: string; records: SupplierRecord[] }[] = [];
  async index(supplier_id: string, records: SupplierRecord[]): Promise<void> {
    this.indexed.push({ supplier_id, records });
  }
  /** What "Moss" holds: the records it was built with. */
  async list(): Promise<SupplierRecord[]> {
    return this.records;
  }
}

// Hero supplier from data/fogline.json.
export const STAGE: SupplierProfile = {
  supplier_id: "sup_stage",
  name: "Stagecraft Rigging Co.",
  phone_on_file: "+14155550100",
  aliases: ["Stagecraft", "Stagecraft Rigging"],
};

export const BAYVIEW: SupplierProfile = {
  supplier_id: "sup_bayview_staging",
  name: "Bayview Staging Systems",
  phone_on_file: "+14155550101",
  aliases: ["Bayview Staging"],
};

export const STAGE_RECORDS: SupplierRecord[] = [
  { id: "bill_4471", supplier_id: "sup_stage", kind: "invoice", ref: "#4471", date: "2026-09-01", text: "Invoice #4471: main-stage truss build.", amount_cents: 1_840_000 },
  { id: "pay_4132", supplier_id: "sup_stage", kind: "payment", ref: "transfer_10129", date: "2026-06-10", text: "Payment for invoice #4132, transfer_10129.", amount_cents: 334_823 },
  { id: "call_4471_verify", supplier_id: "sup_stage", kind: "call", ref: "Call 3 Sep", date: "2026-09-03", text: "Confirmed total and scope on September invoice #4471 (main-stage truss) with Rosa Quintero before payment." },
  { id: "email_4471", supplier_id: "sup_stage", kind: "email", ref: "Email 1 Sep", date: "2026-09-01", text: "Hi, please find invoice #4471 attached. Rosa" },
];

export function stageRequest(overrides: Partial<CallRequest> = {}): CallRequest {
  return {
    call_id: "call_123",
    bill_id: "bill_4488",
    supplier_id: "sup_stage",
    to_number: STAGE.phone_on_file,
    number_source: "on_file",
    reason: ["new bank account", "writing style doesn't match last 14 emails"],
    status: "dialing",
    attempt: 1,
    ...overrides,
  };
}
