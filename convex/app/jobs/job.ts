// What a job plugs into hold's loop (convex/app/improve.ts): its playbook, how it judges one case,
// the past cases it replays with their right answers, and what counts as making it less careful.
// Fraud (./fraud.ts) is the first job and inbox triage (./triage.ts) the second.
import type { z } from "zod";
import type { Doc } from "../../_generated/dataModel.js";
import type { ActionCtx } from "../../_generated/server.js";
import type { Technique } from "../../../lib/fraudTechniques.js";
import type { JobKey, ReplayCase, Verdict } from "../../../lib/loop.js";

export type Trigger = Doc<"improvements">["trigger"];

export interface JobCase {
  id: string; // memo key: the same case judged with the same playbook gives the same verdict
  label: string;
  billKey?: string;
  expected: Verdict;
  trigger?: boolean;
  judge: (playbook: Technique[]) => Promise<Verdict>;
}

/** Every job's proposals share these fields; a job adds its own (fraud: channel, triage: route). */
export interface BaseProposal {
  action: "add" | "refine";
  targetKey: string;
  name: string;
  howItWorks: string;
  signals: string[];
  example: string;
  rationale: string;
}

export interface Job<P extends BaseProposal> {
  key: JobKey;
  /** Who approves a change that makes the job less careful. */
  approver: "dev" | "maya";
  /** "fraud playbook", "inbox playbook": for the Activity log. */
  noun: string;
  schema: z.ZodType<P>;
  /** System prompt for proposing a playbook change. */
  system: string;
  /** The line introducing the case in the propose prompt. */
  describe(trigger: Trigger): string;
  entryXml(entry: Technique): string;
  /** Loads the job's playbook and the cases to replay for this trigger. */
  prepare(ctx: ActionCtx, trigger: Trigger): Promise<{ playbook: Technique[]; cases: (p: P) => JobCase[] }>;
  /** The job-specific fields of the new playbook entry. */
  extra(p: P): Partial<Technique>;
  /** True when the change makes hold less careful, so a person must approve it. */
  loosens(trigger: Trigger, replayed: ReplayCase[]): boolean;
}
