// The job-neutral rules of hold's loop (learn, run, escalate, improve), after Hone: a playbook
// change is promoted only if it gets the case that triggered it right and breaks nothing that the
// old playbook got right. Fraud is the first job on it and inbox triage the second; a job only
// says what a verdict is (lib/fraudTechniques.ts, lib/triage.ts, convex/app/jobs/*).

/** A job's answer for one case: "flag" | "pass" for fraud, a route for triage. */
export type Verdict = string;

export type JobKey = "fraud" | "triage";

/**
 * What started an improvement: a scam hold missed, a false alarm, a person teaching hold, or a
 * person correcting where hold sent something (triage).
 */
export type TriggerKind = "missed_scam" | "false_alarm" | "taught" | "corrected";

export interface ReplayCase {
  label: string;
  billKey?: string;
  expected: Verdict;
  before: Verdict;
  after: Verdict;
  /** The case that triggered this improvement. */
  trigger?: boolean;
}

export interface ReplayScore {
  fixed: boolean;
  /** Cases the old playbook got right and the new one gets wrong. */
  regressions: ReplayCase[];
}

export function scoreReplay(cases: ReplayCase[]): ReplayScore {
  const trigger = cases.find((c) => c.trigger);
  return {
    fixed: trigger ? trigger.after === trigger.expected : false,
    regressions: cases.filter((c) => !c.trigger && c.before === c.expected && c.after !== c.expected),
  };
}

/**
 * What happens after replay. A change that makes hold less careful (the job decides what that
 * means) waits for a named person even when replay passes; anything else goes live on its own.
 */
export function promotion(score: ReplayScore, loosens: boolean): "promote" | "needs_approval" | "retry" {
  if (!score.fixed || score.regressions.length > 0) return "retry";
  return loosens ? "needs_approval" : "promote";
}

/** One line for the Practice screen and the Activity log. */
export function replaySummary(cases: ReplayCase[], score: ReplayScore): string {
  const others = cases.filter((c) => !c.trigger).length;
  const fixedPart = score.fixed ? "handles the new case" : "still gets the new case wrong";
  const regressPart =
    score.regressions.length === 0
      ? "no regressions"
      : `${score.regressions.length} regression${score.regressions.length === 1 ? "" : "s"} (${score.regressions.map((r) => r.label).join(", ")})`;
  return `Replayed on ${others} past case${others === 1 ? "" : "s"} plus the new one: ${fixedPart}, ${regressPart}.`;
}
