// Entry points the server (audio side) calls once a call is connected.
// Implemented by the conversation layer in this folder.
import type { CallRequest, Source } from "../../../shared/contract.js";
import type { SupplierSearch } from "../../../shared/search.js";
import type { VoiceStore } from "../store/types.js";
import type { LLM } from "./llm.js";
import type { CallTransport } from "./transport.js";
import type { Company } from "../../../lib/company.js";

export interface PrepareOutboundDeps {
  request: CallRequest;
  store: VoiceStore;
  search: SupplierSearch;
  llm: LLM;
}

export interface OutboundCallDeps {
  store: VoiceStore;
  transport: CallTransport;
  request: CallRequest;
  /** Questions prepared by prepareOutboundCall() while the phone was ringing (Moss pre-warm). */
  prepared: PreparedCall;
  llm: LLM;
  /** Moss: each answer is searched against the supplier's history as it is given. Absent = no lookups. */
  search?: SupplierSearch;
  /** How long hold waits for a person mid-call before judging on its own. Default OUTBOUND_LIMITS.personTimeoutMs. */
  personTimeoutMs?: number;
}

export interface InboundCallDeps {
  store: VoiceStore;
  transport: CallTransport;
  call_id: string;
  caller_number: string;
  llm: LLM;
}

export interface PreparedQuestion {
  ask: string;
  expected: string; // what the records say, for the judge; never spoken
  source: Source;
  /**
   * "bank_change" marks the fixed "Did you recently change your bank account?" question.
   * "follow_up" is a question the approver wrote: only a person judges its answer.
   */
  kind?: "history" | "bank_change" | "follow_up";
}

export interface PreparedCall {
  supplierName: string;
  questions: PreparedQuestion[]; // 1-3, built from Moss hits on this supplier's history
  /** Who the call speaks for. Absent = Fogline (older fixtures). */
  company?: Company;
  /** The payee's language ("es"): prompts, fixed lines, Cartesia STT and TTS. Absent = English. */
  language?: string;
}

export { prepareOutboundCall, runOutboundCall } from "./outbound.js";
export { runInboundCall } from "./inbound.js";
export { SimulatedTransport, type SimulatedTransportOptions } from "./simulated.js";
export { AnthropicLLM, MODELS, type LLM } from "./llm.js";
