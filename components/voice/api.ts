"use client";
// Every Convex call the voice screens make lives in this file, so a renamed function is a one-line fix.
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import * as mock from "./mock";

export type CallRequestDoc = Doc<"callRequests">;
export type CallEventDoc = Doc<"callEvents">;
export type CallResultDoc = Doc<"callResults">;
export type InboundCallDoc = Doc<"inboundCalls">;

export interface LiveCall {
  request: CallRequestDoc | null;
  /** Oldest first. */
  events: CallEventDoc[];
  result: CallResultDoc | null;
  /** Optional join from voice.ui.liveCall. Without it the screen falls back to supplier_id. */
  supplier?: { name: string; contactName?: string } | null;
}

export interface PhoneLine {
  number: string | null;
  active: InboundCallDoc[];
  /** Newest first. */
  past: InboundCallDoc[];
}

/**
 * Dev-only fixture mode: `?mock=1` (or confirmed | no_answer | dropped | phone) on `next dev`.
 * Null on the server and in production builds, so real data is the only path there.
 */
export const MOCK: mock.Scenario | null =
  process.env.NODE_ENV === "development" && typeof window !== "undefined" ? mock.scenarioFromSearch(window.location.search) : null;

// `undefined` means still loading, as with Convex's useQuery.
// MOCK never changes after page load, so each hook always calls the same inner hooks.
// The `as` casts go away once `npx convex dev` generates a typed `api` (it is AnyApi until then).

export const useLiveCall: (callId: string | undefined) => LiveCall | undefined = MOCK
  ? (callId) => mock.useMockLiveCall(MOCK!, callId)
  : (callId) => useQuery(api.voice.ui.liveCall, callId ? { call_id: callId } : "skip") as LiveCall | undefined;

export const useActiveCall: () => CallRequestDoc | null | undefined = MOCK
  ? () => mock.useMockActiveCall(MOCK!)
  : () => useQuery(api.voice.ui.activeCall, {}) as CallRequestDoc | null | undefined;

export const usePhoneLine: () => PhoneLine | undefined = MOCK
  ? () => mock.useMockPhoneLine(MOCK!)
  : () => useQuery(api.voice.ui.phoneLine, {}) as PhoneLine | undefined;

export const useRequestTakeover: () => (callId: string) => Promise<unknown> = MOCK
  ? () => mock.requestMockTakeover
  : () => {
      const takeover = useMutation(api.voice.ui.requestTakeover);
      return (callId) => takeover({ call_id: callId });
    };

export type CallVerdict = "scam" | "not_scam";

/** Playbook technique key to its name, so a flagged call can name the tactics it matched. */
export const useTacticNames: () => Record<string, string> | undefined = MOCK
  ? () => mock.MOCK_TACTIC_NAMES
  : () => {
      const data = useQuery(api.app.techniques.list, {});
      return data && Object.fromEntries(data.techniques.map((t) => [t.key, t.name]));
    };

/** The supplier a caller claimed to be, by name; null when unknown or not claimed. */
export const useSupplierName: (supplierId: string | undefined) => string | null | undefined = MOCK
  ? (supplierId) => (supplierId ? "Stagecraft Rigging Co." : null)
  : (supplierId) => {
      const s = useQuery(api.app.queries.getSupplier, supplierId ? { key: supplierId } : "skip");
      return supplierId ? (s === undefined ? undefined : (s?.name ?? null)) : null;
    };

/** Report a missed scam call, or clear a flagged one. `key` is null when hold is already learning from it. */
export const useReportCall: () => (callId: string, verdict: CallVerdict) => Promise<{ key: string | null }> = MOCK
  ? () => async () => ({ key: "impr_mock" })
  : () => {
      const report = useMutation(api.app.techniques.reportCall);
      return (callId, verdict) => report({ callId, verdict, actor: "dev" });
    };

export type AskVerdict = "matches" | "no_match" | "follow_up";

/** Dev answers hold's mid-call question (convex/voice/ui.ts answerAsk). */
export const useAnswerAsk: () => (args: { callId: string; askId: string; verdict: AskVerdict; followUp?: string }) => Promise<unknown> =
  MOCK
    ? () => async () => undefined
    : () => {
        const answer = useMutation(api.voice.ui.answerAsk);
        return ({ callId, askId, verdict, followUp }) =>
          answer({ call_id: callId, ask_id: askId, verdict, actor: "dev", ...(followUp !== undefined ? { follow_up: followUp } : {}) });
      };
