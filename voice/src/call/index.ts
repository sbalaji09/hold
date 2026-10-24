// Entry points the server (audio side) calls once a call is connected.
// Implemented by the conversation layer in this folder.
import type { CallRequest, Source } from "../../../shared/contract.js";
import type { SupplierSearch } from "../../../shared/search.js";
import type { VoiceStore } from "../store/types.js";
import type { LLM } from "./llm.js";
import type { CallTransport } from "./transport.js";

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
  /** "bank_change" marks the fixed "Did you recently change your bank account?" question. */
  kind?: "history" | "bank_change";
}

export interface PreparedCall {
  supplierName: string;
  questions: PreparedQuestion[]; // 1-3, built from Moss hits on this supplier's history
}

export { prepareOutboundCall, runOutboundCall } from "./outbound.js";
export { runInboundCall } from "./inbound.js";
export { SimulatedTransport, type SimulatedTransportOptions } from "./simulated.js";
export { AnthropicLLM, MODELS, type LLM } from "./llm.js";
