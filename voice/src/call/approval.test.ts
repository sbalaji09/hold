import { describe, expect, it } from "vitest";
import type { CallEvent } from "../../../shared/contract.js";
import { MemoryStore } from "../store/memoryStore.js";
import { readDecision, spokenPhone } from "./approval.js";
import { runInboundCall } from "./inbound.js";
import { prepareOutboundCall, runOutboundCall } from "./outbound.js";
import { SimulatedTransport } from "./simulated.js";
import { BAYVIEW, FakeLLM, FakeSearch, STAGE, STAGE_RECORDS, stageRequest } from "./testing.js";

const said = (events: CallEvent[]) => events.flatMap((e) => (e.type === "segment" && e.speaker === "callback" ? [e.text] : []));

/** "Jordan from Microsoft" calls the line for gift cards; returns the approval request it books. */
async function microsoftCalls(store: MemoryStore) {
  const llm = new FakeLLM({
    stream: { "answering the phone": "Thanks, Jordan. Someone will review the request and get back to you." },
    json: {
      "summarise a phone call": {
        claimed_identity: "Jordan from Microsoft",
        claimed_company: "Microsoft",
        request: "Fifty dollars in Amazon gift cards",
        asked_bank_change: false,
        payment_claim: "buy fifty dollars in Amazon gift cards for a client event",
      },
    },
  });
  const transport = new SimulatedTransport({
    request: stageRequest(),
    script: ["Hi, this is Jordan from Microsoft. We need fifty dollars in Amazon gift cards for a client event.", "No, that's all, thanks."],
  });
  const record = await runInboundCall({ store, transport, call_id: "in_CA9", caller_number: "+15105550199", llm });
  return { record, request: (await store.getRequest(record.triggered_call_id ?? ""))! };
}

async function approverSays(store: MemoryStore, request: Awaited<ReturnType<typeof microsoftCalls>>["request"], script: string[]) {
  const llm = new FakeLLM();
  const search = new FakeSearch([]);
  const prepared = await prepareOutboundCall({ request, store, search, llm });
  const transport = new SimulatedTransport({ request, script });
  return runOutboundCall({ store, transport, request, prepared, llm, search });
}

describe("a caller from a company hold doesn't know asks for money", () => {
  it("books an approval call to the approver, never a call back to a number they gave", async () => {
    const store = new MemoryStore({ suppliers: [STAGE, BAYVIEW], records: STAGE_RECORDS });
    const { record, request } = await microsoftCalls(store);
    expect(record.claimed_supplier_id).toBeUndefined();
    expect(request).toMatchObject({
      number_source: "approver",
      to_number: "",
      approval: { caller: "Jordan from Microsoft", company: "Microsoft", request: "buy fifty dollars in Amazon gift cards for a client event", caller_number: "+15105550199" },
    });
  });

  it("tells the approver what was asked and records a denial", async () => {
    const store = new MemoryStore({ suppliers: [STAGE, BAYVIEW], records: STAGE_RECORDS });
    const { request } = await microsoftCalls(store);
    const result = await approverSays(store, request, ["No, deny it."]);
    expect(result.outcome).toBe("not_confirmed");
    const lines = said(store.eventsFor(request.call_id)).join(" ");
    expect(lines).toContain("Jordan from Microsoft");
    expect(lines).toContain("buy fifty dollars in Amazon gift cards for a client event");
    expect(lines).toContain("Do you approve or deny it?");
    expect(lines).toContain("Got it, denied.");
    expect(lines).not.toMatch(/invoice/i); // not a check call
  });

  it("records an approval", async () => {
    const store = new MemoryStore({ suppliers: [STAGE, BAYVIEW], records: STAGE_RECORDS });
    const { request } = await microsoftCalls(store);
    expect((await approverSays(store, request, ["Yes, approve it."])).outcome).toBe("confirmed");
  });

  it("asks again when unclear, then leaves it unapproved", async () => {
    const store = new MemoryStore({ suppliers: [STAGE, BAYVIEW], records: STAGE_RECORDS });
    const { request } = await microsoftCalls(store);
    const result = await approverSays(store, request, ["Hmm, who is this?", "Don't approve it yet."]);
    expect(result.outcome).toBe("handed_off");
    expect(said(store.eventsFor(request.call_id)).join(" ")).toContain("Should I approve or deny the request?");
  });
});

describe("readDecision", () => {
  it.each([
    ["Approve it.", "approved"],
    ["Yes, go ahead.", "approved"],
    ["Deny.", "denied"],
    ["No.", "denied"],
    ["Reject that.", "denied"],
    ["Don't approve it.", "no_decision"],
    ["Who is this?", "no_decision"],
  ])("%j -> %s", (text, decision) => {
    expect(readDecision(text)).toBe(decision);
  });
});

it("reads a phone number digit by digit", () => {
  expect(spokenPhone("+15105550199")).toBe("5 1 0, 5 5 5, 0 1 9 9");
});
