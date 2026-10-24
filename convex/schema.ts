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
  // voice: id of the record the question came from, so the UI can open it.
  record_id: v.optional(v.string()),
});

export default defineSchema({
  suppliers: defineTable({
    key: v.string(),
    name: v.string(),
    // A key of the company's categories (lib/company.ts), or "other". Was a festival-only union.
    category: v.string(),
    domain: v.string(),
    contactName: v.string(),
    contactEmail: v.string(),
    trustedPhone: v.string(),
    phoneLastCheckedAt: v.string(),
    // Hyphenate addendum: New until first confirmed call. Absent = Trusted.
    status: v.optional(v.union(v.literal("new"), v.literal("trusted"), v.literal("under_review"))),
    // Calls (voice): the language to speak, a BCP-47 code Cartesia takes ("en", "es"). Absent = "en".
    language: v.optional(v.string()),
    // Keys pressed after the line picks up to reach the right person, Twilio sendDigits ("ww2").
    phoneMenu: v.optional(v.string()),
    // IANA zone for calling hours. Absent = the company's.
    timeZone: v.optional(v.string()),
    // New suppliers (convex/app/onboarding.ts): how hold met them and what Fogline knows about them.
    onboarding: v.optional(
      v.object({
        source: v.union(v.literal("email"), v.literal("manual")),
        firstBillKey: v.optional(v.string()),
        // Numbers that appeared in the supplier's own email. Kept only so they can never become
        // the trusted number: a check call must not reach whoever wrote the email.
        emailPhones: v.array(v.string()),
        // Fogline's own facts about the engagement: what check-call questions are built from,
        // since nothing on the web is secret enough to verify a new supplier with.
        note: v.optional(
          v.object({
            hiredFor: v.string(),
            agreed: v.string(),
            dates: v.string(),
            foglineContact: v.string(),
          }),
        ),
        confirmedBy: v.optional(v.union(v.literal("maya"), v.literal("dev"))),
        confirmedAt: v.optional(v.string()),
      }),
    ),
  }).index("by_key", ["key"]),

  bankAccounts: defineTable({
    key: v.string(),
    supplierKey: v.string(),
    bank: v.string(),
    last4: v.string(),
    routingLast4: v.string(),
    // Full sandbox routing/account numbers, needed to send an Increase ACH transfer. Optional:
    // older rows (or any source without them) stay valid; never rendered in the UI, only read
    // server-side by convex/app/increase.ts's runPayments action.
    routingNumber: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("retired")),
    verifiedBy: v.union(v.literal("onboarding"), v.literal("call+dev")),
    addedAt: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_supplier", ["supplierKey"]),

  // `checks` is additive: written by checks.ts (intake) once step-2 evaluation runs. Optional so
  // rows written before that logic lands (or by seed) stay valid.
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
    // Practice-generated bills (Practice screen's "Generate set") live in the same table so
    // Practice can link to them, but never count toward the real Inbox/Approvals/Payments/
    // Suppliers views (see convex/app/queries.ts). Absent/false = a real bill.
    practice: v.optional(v.boolean()),
    checks: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          state: v.union(v.literal("pass"), v.literal("flag"), v.literal("info")),
          evidence: v.string(),
          quote: v.optional(v.string()),
          cite: v.object({
            kind: v.union(v.literal("email"), v.literal("bill"), v.literal("supplier"), v.literal("call"), v.literal("payment")),
            ref: v.string(),
          }),
        }),
      ),
    ),
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
    // The webhook payload's provider message id, when it has one. Used to dedupe a resent
    // inbound-email webhook (convex/app/intake.ts) without creating a second bill.
    messageId: v.optional(v.string()),
    // Inbox triage (convex/app/triage.ts): what kind of email this is and where hold sent it.
    // Absent on bills from before triage, and on emails that became bills.
    triage: v.optional(
      v.object({
        supplierKey: v.optional(v.string()),
        kindKey: v.optional(v.string()),
        kindName: v.string(),
        route: v.union(v.literal("bill"), v.literal("to_maya"), v.literal("file")),
        why: v.string(),
        quote: v.optional(v.string()),
        status: v.union(v.literal("open"), v.literal("done"), v.literal("filed")),
        correctedRoute: v.optional(v.union(v.literal("bill"), v.literal("to_maya"), v.literal("file"))),
        correctedBy: v.optional(v.union(v.literal("maya"), v.literal("dev"))),
      }),
    ),
  })
    .index("by_key", ["key"])
    .index("by_bill", ["billKey"])
    .index("by_message_id", ["messageId"])
    .index("by_sender_subject", ["fromAddress", "subject"]),

  payments: defineTable({
    key: v.string(),
    billKey: v.string(),
    amountCents: v.number(),
    bankAccountKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
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
    // queued -> dialing -> in_progress -> done. No answer: retry_scheduled ->
    // queued (one retry) -> handed_off. Seed data for historical calls writes "done".
    status: v.union(
      v.literal("queued"),
      v.literal("dialing"),
      v.literal("in_progress"),
      v.literal("retry_scheduled"),
      v.literal("done"),
      v.literal("handed_off"),
    ),
    startedAt: v.optional(v.string()),
    // --- voice-owned bookkeeping (all optional so seed rows stay valid) ---
    // "simulated" = Practice: a Claude-played supplier, never dials a phone.
    mode: v.optional(v.union(v.literal("live"), v.literal("simulated"))),
    attempt: v.optional(v.number()), // dial attempts made so far (absent = 0)
    retry_at_ms: v.optional(v.number()),
    twilio_call_sid: v.optional(v.string()),
    takeover_requested: v.optional(v.boolean()),
    // The recording can arrive before the result row exists; it waits here.
    recording_storage_id: v.optional(v.id("_storage")),
  })
    .index("by_key", ["call_id"])
    .index("by_bill", ["bill_id"])
    .index("by_supplier", ["supplier_id"])
    .index("by_status", ["status"]),

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
          v.literal("dropped"),
          v.literal("ended"),
        ),
        retry_at: v.optional(v.string()),
        retry_at_ms: v.optional(v.number()),
      }),
      v.object({
        call_id: v.string(),
        type: v.literal("segment"),
        // "caller" = inbound calls, whose live transcript also streams here.
        speaker: v.union(v.literal("callback"), v.literal("supplier"), v.literal("caller")),
        text: v.string(),
        ts: v.number(),
        end_ts: v.optional(v.number()),
      }),
      v.object({
        call_id: v.string(),
        type: v.literal("question"),
        ask: v.string(),
        source: callEventSource,
      }),
      // hold asked a person to judge an answer mid-call (shared/contract.ts AskPersonEvent).
      v.object({
        call_id: v.string(),
        type: v.literal("ask_person"),
        ask_id: v.string(),
        ask: v.string(),
        answer: v.string(),
        expected: v.string(),
        source: callEventSource,
        follow_up_allowed: v.boolean(),
      }),
      v.object({
        call_id: v.string(),
        type: v.literal("person_answer"),
        ask_id: v.string(),
        verdict: v.union(v.literal("matches"), v.literal("no_match"), v.literal("follow_up"), v.literal("no_reply")),
        follow_up: v.optional(v.string()),
        by: v.optional(v.union(v.literal("maya"), v.literal("dev"))),
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
        decided_by: v.optional(v.union(v.literal("maya"), v.literal("dev"))),
      }),
    ),
    summary: v.string(),
    recording_url: v.string(), // "" until the recording lands
    recording_storage_id: v.optional(v.id("_storage")),
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
    // --- voice-owned (optional so seed rows stay valid) ---
    status: v.optional(v.union(v.literal("in_progress"), v.literal("ended"))),
    claimed_supplier_id: v.optional(v.string()),
    asked_bank_change: v.optional(v.boolean()),
    endedAt: v.optional(v.string()),
    // Twilio's recording of the call, copied into Convex storage once it finishes.
    recording_storage_id: v.optional(v.id("_storage")),
    recording_url: v.optional(v.string()),
    // hold's playbook verdict on the call, written after it ends (convex/voice/callScreen.ts).
    fraud: v.optional(
      v.object({
        state: v.union(v.literal("flag"), v.literal("pass")),
        evidence: v.string(),
        quote: v.optional(v.string()),
        techniqueKeys: v.array(v.string()),
        assessedAt: v.string(),
      }),
    ),
  })
    .index("by_key", ["call_id"])
    .index("by_received", ["receivedAt"]),

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
    routedTo: v.optional(v.union(v.literal("maya"), v.literal("dev"))),
    reason: v.optional(v.string()),
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

  // Learned rules: saved when a human resolves an escalation. Never relax hard limits.
  learnedRules: defineTable({
    key: v.string(),
    supplierKey: v.string(),
    text: v.string(),
    createdBy: v.union(v.literal("maya"), v.literal("dev")),
    sourceKind: v.string(),
    sourceKey: v.string(),
    createdAt: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_supplier", ["supplierKey"]),

  // Apify background / copycat check results, one row per run.
  backgroundChecks: defineTable({
    key: v.string(),
    kind: v.union(v.literal("background"), v.literal("copycat")),
    supplierKey: v.optional(v.string()),
    billKey: v.optional(v.string()),
    domain: v.string(),
    ranAt: v.string(),
    findings: v.array(
      v.object({
        label: v.string(),
        state: v.union(v.literal("pass"), v.literal("flag"), v.literal("info")),
        evidence: v.string(),
        sourceUrl: v.optional(v.string()),
      }),
    ),
    suggestedPhone: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_supplier", ["supplierKey"])
    .index("by_bill", ["billKey"]),

  // Global toggles (currently just Watch only). Single row keyed "global"; the JSON
  // fallback (lib/data.ts) has no table to read, so it always reports this off.
  settings: defineTable({
    key: v.string(),
    watchOnly: v.boolean(),
    // Which company this deployment works for (lib/company.ts). Absent = Fogline.
    company: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // hold's playbooks, one per job of its loop: fraud techniques (job absent or "fraud") and the
  // kinds of supplier email it sorts (job "triage"). The table predates the second job, hence the
  // name. Rows are never edited in place: a refinement is a new row that supersedes the old one,
  // so any change can be reverted. See convex/app/techniques.ts and convex/app/triage.ts.
  // ponytail: rename to playbookEntries once a data migration is worth the churn.
  fraudTechniques: defineTable({
    key: v.string(),
    name: v.string(),
    job: v.optional(v.union(v.literal("fraud"), v.literal("triage"))),
    // Triage only: where emails of this kind go.
    route: v.optional(v.union(v.literal("bill"), v.literal("to_maya"), v.literal("file"))),
    // Where hold looks for it. Absent = email (rows from before the phone line used the playbook).
    channel: v.optional(v.union(v.literal("email"), v.literal("phone"), v.literal("both"))),
    howItWorks: v.string(),
    signals: v.array(v.string()),
    example: v.string(),
    status: v.union(v.literal("active"), v.literal("retired")),
    // Where hold learned it: the seed playbook, a missed scam, a false alarm, or a person teaching it.
    sourceKind: v.union(v.literal("seed"), v.literal("missed_scam"), v.literal("false_alarm"), v.literal("taught"), v.literal("corrected")),
    sourceRef: v.optional(v.string()),
    supersedes: v.optional(v.string()),
    improvementKey: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_status", ["status"]),

  // Practice for the phone line: scripted calls, scam and ordinary, that phone playbook changes
  // replay against. "flag" calls must be caught; "pass" calls must not be.
  practiceCalls: defineTable({
    key: v.string(),
    kind: v.string(),
    transcript: v.string(),
    expected: v.union(v.literal("flag"), v.literal("pass")),
    source: v.union(v.literal("seed"), v.literal("reported")),
    caughtLastRun: v.optional(v.boolean()),
    lastRunAt: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // Practice for inbox triage: supplier emails with the route a person says is right. Triage
  // playbook changes replay against these.
  practiceEmails: defineTable({
    key: v.string(),
    kind: v.string(),
    text: v.string(),
    expected: v.union(v.literal("bill"), v.literal("to_maya"), v.literal("file")),
    source: v.union(v.literal("seed"), v.literal("corrected")),
    caughtLastRun: v.optional(v.boolean()),
    lastRunAt: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // Self-improvement log (Hone's loop): what triggered a change, the change hold proposed, how it
  // replayed against past cases, and whether it was promoted. See convex/app/improve.ts.
  improvements: defineTable({
    key: v.string(),
    job: v.optional(v.union(v.literal("fraud"), v.literal("triage"))), // absent = fraud
    trigger: v.object({
      kind: v.union(v.literal("missed_scam"), v.literal("false_alarm"), v.literal("taught"), v.literal("corrected")),
      billKey: v.optional(v.string()),
      text: v.string(), // the scam email or call transcript, or what the person described
      by: v.union(v.literal("callback"), v.literal("maya"), v.literal("dev")),
      // Phone triggers: the inbound call or Practice call it came from.
      channel: v.optional(v.union(v.literal("email"), v.literal("phone"))),
      callId: v.optional(v.string()),
      // Triage corrections: the email, and the route a person said was right.
      emailKey: v.optional(v.string()),
      expected: v.optional(v.string()),
    }),
    status: v.union(
      v.literal("proposing"),
      v.literal("replaying"),
      v.literal("promoted"),
      v.literal("needs_approval"),
      v.literal("rejected"),
      v.literal("declined"),
      v.literal("reverted"),
    ),
    proposal: v.optional(
      v.object({
        action: v.union(v.literal("add"), v.literal("refine")),
        route: v.optional(v.union(v.literal("bill"), v.literal("to_maya"), v.literal("file"))),
        channel: v.optional(v.union(v.literal("email"), v.literal("phone"), v.literal("both"))),
        targetKey: v.optional(v.string()),
        name: v.string(),
        howItWorks: v.string(),
        signals: v.array(v.string()),
        example: v.string(),
        rationale: v.string(),
      }),
    ),
    replay: v.optional(
      v.object({
        attempts: v.number(),
        fixed: v.boolean(),
        regressions: v.number(),
        cases: v.array(
          v.object({
            label: v.string(),
            billKey: v.optional(v.string()),
            // "flag" | "pass" for fraud, a route for triage.
            expected: v.string(),
            before: v.string(),
            after: v.string(),
          }),
        ),
      }),
    ),
    summary: v.optional(v.string()), // plain words for the Practice screen and the Activity log
    techniqueKey: v.optional(v.string()), // the playbook row it created, once promoted
    decidedBy: v.optional(v.union(v.literal("callback"), v.literal("maya"), v.literal("dev"))),
    createdAt: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_bill", ["trigger.billKey"]),
});
