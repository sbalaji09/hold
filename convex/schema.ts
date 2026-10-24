import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Every record carries a stable string `key` (e.g. "sup_stage", "bill_4471")
// instead of relying on Convex's internal _id, so seed data, fixtures and
// cross-references in docs/demo scripts stay human-readable and stable
// across reseeds. Cross-table refs use those keys (`supplierKey`, `billKey`,
// `bankAccountKey`, `callKey`), not Convex ids.

const billStatus = v.union(
  v.literal("Paid"),
  v.literal("Scheduled"),
  v.literal("Checking"),
  v.literal("Calling"),
  v.literal("Held"),
  v.literal("Needs you"),
);

// Live-call event union, shared by callEvents below. Matches plan-agent.md
// "Interface contract" §2 exactly (voice -> Convex).
const callEventSource = v.object({
  kind: v.string(),
  ref: v.string(),
});

export default defineSchema({
  suppliers: defineTable({
    key: v.string(),
    name: v.string(),
    category: v.union(
      v.literal("stage"),
      v.literal("sound"),
      v.literal("security"),
      v.literal("agency"),
      v.literal("food"),
      v.literal("other"),
    ),
    domain: v.string(),
    contactName: v.string(),
    contactEmail: v.string(),
    trustedPhone: v.string(),
    phoneLastCheckedAt: v.string(),
  }).index("by_key", ["key"]),

  bankAccounts: defineTable({
    key: v.string(),
    supplierKey: v.string(),
    bank: v.string(),
    last4: v.string(),
    routingLast4: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    verifiedBy: v.union(v.literal("onboarding"), v.literal("call+dev")),
    addedAt: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_supplier", ["supplierKey"]),

  bills: defineTable({
    key: v.string(),
    supplierKey: v.string(),
    invoiceNo: v.string(),
    amountCents: v.number(),
    currency: v.literal("USD"),
    dueDate: v.string(),
    receivedAt: v.string(),
    bankAccountKey: v.string(),
    status: billStatus,
    emailKey: v.string(),
    planted: v.boolean(),
  })
    .index("by_key", ["key"])
    .index("by_supplier", ["supplierKey"])
    .index("by_status", ["status"]),

  emails: defineTable({
    key: v.string(),
    billKey: v.union(v.string(), v.null()),
    fromAddress: v.string(),
    fromDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
  })
    .index("by_key", ["key"])
    .index("by_bill", ["billKey"]),

  payments: defineTable({
    key: v.string(),
    billKey: v.string(),
    amountCents: v.number(),
    bankAccountKey: v.string(),
    status: v.string(),
    transferId: v.optional(v.string()),
    paidAt: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_bill", ["billKey"]),

  // --- Call tables: shapes follow plan-agent.md "Interface contract" §1-3
  // and the inbound-call description in §5, field-for-field. ---

  callRequests: defineTable({
    call_id: v.string(),
    bill_id: v.string(),
    supplier_id: v.string(),
    to_number: v.string(),
    number_source: v.union(v.literal("on_file"), v.literal("background_check")),
    reason: v.array(v.string()),
    // voice sets "in_progress" once dialing starts, then "done" when the
    // call finishes; seed data for historical calls writes "done" directly.
    status: v.union(v.literal("queued"), v.literal("in_progress"), v.literal("done")),
    startedAt: v.optional(v.string()),
  })
    .index("by_key", ["call_id"])
    .index("by_bill", ["bill_id"])
    .index("by_supplier", ["supplier_id"]),

  callEvents: defineTable(
    v.union(
      v.object({
        call_id: v.string(),
        type: v.literal("status"),
        value: v.union(
          v.literal("ringing"),
          v.literal("in_progress"),
          v.literal("no_answer"),
          v.literal("retry_scheduled"),
          v.literal("ended"),
        ),
        retry_at: v.optional(v.string()),
      }),
      v.object({
        call_id: v.string(),
        type: v.literal("segment"),
        speaker: v.union(v.literal("callback"), v.literal("supplier")),
        text: v.string(),
        ts: v.number(),
      }),
      v.object({
        call_id: v.string(),
        type: v.literal("question"),
        ask: v.string(),
        source: callEventSource,
      }),
    ),
  ).index("by_call", ["call_id"]),

  callResults: defineTable({
    call_id: v.string(),
    outcome: v.union(
      v.literal("confirmed"),
      v.literal("not_confirmed"),
      v.literal("handed_off"),
    ),
    evidence: v.array(
      v.object({
        ask: v.string(),
        source: v.optional(callEventSource),
        answer: v.string(),
        matches: v.boolean(),
      }),
    ),
    summary: v.string(),
    recording_url: v.string(),
    startedAt: v.optional(v.string()),
    clip: v.optional(
      v.object({
        start_s: v.number(),
        end_s: v.number(),
      }),
    ),
  }).index("by_call", ["call_id"]),

  // §5: voice writes this when the company's own line rings. If the caller
  // asked to change bank details, voice separately writes a callRequests row
  // to the supplier's on-file number; nothing is ever changed from an
  // incoming call.
  inboundCalls: defineTable({
    call_id: v.string(),
    caller_number: v.string(),
    claimed_identity: v.string(),
    requested: v.string(),
    transcript: v.array(
      v.object({
        speaker: v.union(v.literal("callback"), v.literal("caller")),
        text: v.string(),
        ts: v.number(),
      }),
    ),
    triggered_call_id: v.optional(v.string()),
    receivedAt: v.string(),
  }).index("by_key", ["call_id"]),

  approvals: defineTable({
    key: v.string(),
    billKey: v.string(),
    kind: v.union(
      v.literal("big_payment"),
      v.literal("held_payment"),
      v.literal("bank_change"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    recommendation: v.string(),
    thread: v.array(
      v.object({
        from: v.string(),
        text: v.string(),
        at: v.string(),
      }),
    ),
  })
    .index("by_key", ["key"])
    .index("by_bill", ["billKey"])
    .index("by_status", ["status"]),

  activity: defineTable({
    key: v.string(),
    actor: v.union(v.literal("callback"), v.literal("maya"), v.literal("dev")),
    what: v.string(),
    why: v.string(),
    refKind: v.string(),
    refKey: v.string(),
    at: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_ref", ["refKind", "refKey"]),

  // Practice mode: fake scams (from fogline.json's plantedScams plus any a
  // judge adds via "Try a scam"), and whether the agent caught each one the
  // last time Practice ran.
  practiceScams: defineTable({
    key: v.string(),
    billKey: v.string(),
    kind: v.string(),
    description: v.string(),
    checksThatShouldFire: v.array(v.string()),
    caughtLastRun: v.optional(v.boolean()),
    lastRunAt: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_bill", ["billKey"]),
});
