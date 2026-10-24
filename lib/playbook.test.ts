// The plain words the Practice screen shows for a playbook change and where a technique came from.
import { describe, expect, test } from "vitest";
import { channelLabel, countWord, improvementMark, progressLine, recordLink, techniqueSource, triggerBy, triggerTitle, type FraudTechnique, type Improvement } from "./playbook";

const names = { bill_1: "INV-4502 · Stagecraft Rigging Co.", in_CA1: "(628) 555-0199", pcall_1: "Bank fraud team asks for a code" };

function impr(over: Partial<Improvement>): Improvement {
  return {
    _id: "x" as Improvement["_id"],
    _creationTime: 0,
    key: "impr_1",
    trigger: { kind: "missed_scam", billKey: "bill_1", text: "...", by: "callback" },
    status: "proposing",
    createdAt: "2026-10-21T10:00:00Z",
    ...over,
  };
}

describe("playbook words", () => {
  test("names the trigger and who raised it", () => {
    expect(triggerTitle(impr({}).trigger, names)).toBe("Missed scam on INV-4502 · Stagecraft Rigging Co.");
    expect(triggerBy(impr({}).trigger)).toEqual({ person: null, text: "Found in a Practice run" });
    const taught = impr({ trigger: { kind: "taught", text: "...", by: "dev" } }).trigger;
    expect(triggerTitle(taught, names)).toBe("A new technique to learn");
    expect(triggerBy(taught)).toEqual({ person: "You", text: "Taught by" });
    expect(triggerTitle({ kind: "false_alarm", billKey: "gone", text: "", by: "callback" }, names)).toBe("False alarm on a bill");
  });

  test("a change that came from a call", () => {
    const reported = { kind: "missed_scam" as const, channel: "phone" as const, callId: "in_CA1", text: "Caller: hi", by: "dev" as const };
    expect(triggerTitle(reported, names)).toBe("Scam call from (628) 555-0199");
    expect(triggerTitle({ ...reported, kind: "false_alarm", callId: "in_gone" }, names)).toBe("Call wrongly flagged to the phone line");
    const practice = { ...reported, kind: "false_alarm" as const, callId: "pcall_1", by: "callback" as const };
    expect(triggerTitle(practice, names)).toBe("Practice call judged wrong: Bank fraud team asks for a code");
    expect(triggerBy(practice)).toEqual({ person: null, text: "Found in a Practice run" });
    expect(recordLink("pcall_1")).toEqual({ href: "#pcall_1", label: "The Practice call" });
    expect(channelLabel(undefined)).toBe("Email");
    expect(channelLabel("both")).toBe("Email and phone");
  });

  test("progress only while hold is working, with the case count once known", () => {
    expect(progressLine(impr({ status: "promoted" }))).toBeNull();
    expect(progressLine(impr({ status: "replaying" }))).toBe("Learning… replaying past cases");
    const replay = { attempts: 1, fixed: false, regressions: 0, cases: [1, 2, 3].map(() => ({ label: "c", expected: "flag" as const, before: "pass" as const, after: "pass" as const })) };
    expect(progressLine(impr({ status: "replaying", replay }))).toBe("Learning… replaying 3 past cases again");
  });

  test("a technique's source", () => {
    const t = { key: "t", sourceKind: "taught", improvementKey: "impr_1", status: "active" } as FraudTechnique;
    expect(techniqueSource(t, [impr({ trigger: { kind: "taught", text: "", by: "dev" } })], names)).toEqual({ text: "Taught by", person: "You", link: null });
    expect(techniqueSource({ ...t, sourceKind: "seed" }, [], names).text).toBe("Starting playbook");
    expect(techniqueSource({ ...t, sourceKind: "missed_scam", sourceRef: "bill_1" }, [], names)).toEqual({
      text: "Learned from a missed scam on INV-4502 · Stagecraft Rigging Co.",
      person: null,
      link: { href: "/bills/bill_1", label: "Open the bill" },
    });
    expect(techniqueSource({ ...t, sourceKind: "missed_scam", sourceRef: "in_CA1" }, [], names)).toEqual({
      text: "Learned from a scam call from (628) 555-0199",
      person: null,
      link: { href: "/phone?call=in_CA1", label: "Open the call" },
    });
    expect(techniqueSource({ ...t, sourceKind: "false_alarm", sourceRef: "pcall_1" }, [], names).text).toBe(
      "Learned from the Practice call \u201cBank fraud team asks for a code\u201d",
    );
    expect(countWord(0)).toBe("No");
    expect(countWord(14)).toBe("14");
  });

  test("triage changes: corrections, Practice emails, and approval wording", () => {
    const tnames = { email_in_1: "Re: load-in schedule", pmail_1: "Payment reminder" };
    const corrected = { kind: "corrected" as const, emailKey: "email_in_1", expected: "to_dev", text: "Hi team, load-in moves.", by: "dev" as const };
    expect(triggerTitle(corrected, tnames, "triage")).toBe("You corrected an email: Re: load-in schedule");
    expect(triggerTitle({ ...corrected, emailKey: "email_gone" }, tnames, "triage")).toBe("You corrected an email: Hi team, load-in moves.");
    expect(triggerBy(corrected)).toEqual({ person: "You", text: "Corrected by" });
    const practice = { ...corrected, emailKey: "pmail_1", by: "callback" as const };
    expect(triggerTitle(practice, tnames, "triage")).toBe("Practice email sorted wrong: Payment reminder");
    expect(triggerBy(practice)).toEqual({ person: null, text: "Found in a Practice run" });
    expect(triggerTitle({ kind: "taught", text: "", by: "dev" }, tnames, "triage")).toBe("A new kind of email to learn");
    expect(recordLink("pmail_1")).toEqual({ href: "#pmail_1", label: "The Practice email" });
    expect(recordLink("email_in_1")).toEqual({ href: "/messages/email_in_1", label: "Open the email" });
    expect(improvementMark({ status: "needs_approval", job: "triage" }).label).toBe("Waiting for your approval");
    expect(improvementMark({ status: "needs_approval", job: undefined }).label).toBe("Waiting for your approval");
    const t = { key: "t", sourceKind: "corrected", sourceRef: "email_in_1", improvementKey: "impr_1", status: "active" } as FraudTechnique;
    expect(techniqueSource(t, [impr({ trigger: corrected })], tnames)).toEqual({
      text: "Learned from \u201cRe: load-in schedule\u201d, corrected by",
      person: "You",
      link: { href: "/messages/email_in_1", label: "Open the email" },
    });
    expect(techniqueSource({ ...t, sourceRef: "pmail_1" }, [], tnames).text).toBe("Learned from the Practice email \u201cPayment reminder\u201d");
  });
});
