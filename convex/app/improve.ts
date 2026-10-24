// hold's loop engine, after Hone (hone.com): Discover a case it got wrong, Propose a playbook
// change, Replay past cases with and without it, and Promote only if it fixes the case and breaks
// nothing. Job-neutral: each job (./jobs/) brings its playbook, its judge and its replay cases.
// Fraud is the first job and inbox triage the second; adding a job means writing one adapter.
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { v } from "convex/values";
import { internal } from "../_generated/api.js";
import { internalAction, internalMutation, internalQuery } from "../_generated/server.js";
import type { Technique } from "../../lib/fraudTechniques.js";
import { promotion, replaySummary, scoreReplay, type JobKey, type ReplayCase, type Verdict } from "../../lib/loop.js";
import { fraudJob } from "./jobs/fraud.js";
import type { BaseProposal, Job, JobCase, Trigger } from "./jobs/job.js";
import { triageJob } from "./jobs/triage.js";
import { ASSESS_MODEL, anthropic, promoteImprovement } from "./techniques.js";

const MAX_ATTEMPTS = 2; // the first proposal, and one revision after a failed replay
const PARALLEL = 6;

export const JOBS: Record<JobKey, Job<BaseProposal>> = {
  fraud: fraudJob as unknown as Job<BaseProposal>,
  triage: triageJob as unknown as Job<BaseProposal>,
};

// ---------- data ----------

export const getImprovement = internalQuery({
  args: { key: v.string() },
  handler: (ctx, { key }) =>
    ctx.db
      .query("improvements")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
});

export const recordProgress = internalMutation({
  args: {
    key: v.string(),
    status: v.union(v.literal("replaying"), v.literal("rejected"), v.literal("needs_approval"), v.literal("promoted")),
    proposal: v.optional(v.any()),
    replay: v.optional(v.any()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, { key, status, proposal, replay, summary }) => {
    const row = await ctx.db
      .query("improvements")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      status: status === "promoted" ? "replaying" : status, // promoteImprovement sets "promoted"
      ...(proposal ? { proposal } : {}),
      ...(replay ? { replay } : {}),
      ...(summary ? { summary } : {}),
    });
    if (status === "promoted") await promoteImprovement(ctx, key, "callback");
    if (status === "rejected" || status === "needs_approval") {
      const job = JOBS[row.job ?? "fraud"];
      await ctx.db.insert("activity", {
        key: `act_${crypto.randomUUID()}`,
        actor: "callback",
        what: status === "rejected" ? `kept its ${job.noun} as it was` : `asked for approval of a less strict ${job.noun}`,
        why: summary ?? "",
        refKind: row.trigger.billKey ? "bill" : "improvement",
        refKey: row.trigger.billKey ?? key,
        at: new Date().toISOString(),
      });
    }
  },
});

// ---------- propose ----------

async function propose<P extends BaseProposal>(
  job: Job<P>,
  trigger: Trigger,
  playbook: Technique[],
  revision?: { previous: P; failures: ReplayCase[] },
): Promise<P> {
  const book = playbook.map((t) => job.entryXml(t)).join("\n");
  const again = revision
    ? `\n\nYour previous proposal failed replay:\n${JSON.stringify(revision.previous)}\nCases it got wrong:\n${revision.failures
        .map((f) => `- ${f.label}: expected ${f.expected}, got ${f.after}`)
        .join("\n")}\nRevise it so these come out right.`
    : "";
  const right = trigger.expected ? `\nThe right answer for this case: ${trigger.expected}.` : "";
  const response = await anthropic().messages.parse({
    model: ASSESS_MODEL,
    max_tokens: 3000,
    output_config: { effort: "medium", format: zodOutputFormat(job.schema) },
    system: job.system,
    messages: [{ role: "user", content: `<playbook>\n${book}\n</playbook>\n\n${job.describe(trigger)}\n<case>\n${trigger.text}\n</case>${right}${again}` }],
  });
  const p = response.parsed_output as P | null;
  if (response.stop_reason === "refusal" || !p) throw new Error(`no proposal from Claude (stop_reason ${response.stop_reason})`);
  if (p.action === "refine" && !playbook.some((t) => t.key === p.targetKey)) return { ...p, action: "add", targetKey: "" };
  return p;
}

function applyProposal<P extends BaseProposal>(job: Job<P>, playbook: Technique[], p: P): Technique[] {
  const candidate: Technique = { key: "tech_candidate", name: p.name, howItWorks: p.howItWorks, signals: p.signals, example: p.example, job: job.key, ...job.extra(p) };
  return [...playbook.filter((t) => !(p.action === "refine" && t.key === p.targetKey)), candidate];
}

// ---------- replay ----------

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- the loop ----------

export const run = internalAction({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const impr = await ctx.runQuery(internal.app.improve.getImprovement, { key });
    if (!impr || impr.status !== "proposing") return;
    const job = JOBS[impr.job ?? "fraud"];

    try {
      const { playbook, cases } = await job.prepare(ctx, impr.trigger);
      let proposal = await propose(job, impr.trigger, playbook);

      const before = new Map<string, Promise<Verdict>>();
      const judgeBefore = (c: JobCase) => {
        if (!before.has(c.id)) before.set(c.id, c.judge(playbook));
        return before.get(c.id)!;
      };
      for (let attempt = 1; ; attempt++) {
        await ctx.runMutation(internal.app.improve.recordProgress, { key, status: "replaying", proposal });
        const set = cases(proposal);
        const candidate = applyProposal(job, playbook, proposal);
        const beforeV = await pool(set, judgeBefore);
        const after = await pool(set, (c) => c.judge(candidate));
        const replayed: ReplayCase[] = set.map((c, i) => ({ label: c.label, billKey: c.billKey, expected: c.expected, before: beforeV[i]!, after: after[i]!, trigger: c.trigger }));
        const score = scoreReplay(replayed);
        const next = promotion(score, job.loosens(impr.trigger, replayed));
        const summary = `${proposal.rationale.trim().replace(/([^.!?])$/, "$1.")} ${replaySummary(replayed, score)}`;
        const replay = {
          attempts: attempt,
          fixed: score.fixed,
          regressions: score.regressions.length,
          cases: replayed.map(({ trigger: _t, ...c }) => c),
        };
        if (next !== "retry") {
          await ctx.runMutation(internal.app.improve.recordProgress, { key, status: next === "promote" ? "promoted" : "needs_approval", proposal, replay, summary });
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          await ctx.runMutation(internal.app.improve.recordProgress, { key, status: "rejected", proposal, replay, summary });
          return;
        }
        const failures = replayed.filter((c) => c.after !== c.expected && (c.trigger || c.before === c.expected));
        proposal = await propose(job, impr.trigger, playbook, { previous: proposal, failures });
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.app.improve.recordProgress, { key, status: "rejected", summary: `hold couldn't finish learning from this: ${why}` });
    }
  },
});
