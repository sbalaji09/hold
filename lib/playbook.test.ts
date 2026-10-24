// The plain words the Practice screen shows for a playbook change and where a technique came from.
import { describe, expect, test } from "vitest";
import { countWord, progressLine, techniqueSource, triggerBy, triggerTitle, type FraudTechnique, type Improvement } from "./playbook";

const names = { bill_1: "INV-4502 · Stagecraft Rigging Co." };

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
    const taught = impr({ trigger: { kind: "taught", text: "...", by: "maya" } }).trigger;
    expect(triggerTitle(taught, names)).toBe("A new technique to learn");
    expect(triggerBy(taught)).toEqual({ person: "Maya Lin", text: "Taught by" });
    expect(triggerTitle({ kind: "false_alarm", billKey: "gone", text: "", by: "callback" }, names)).toBe("False alarm on a bill");
  });

  test("progress only while hold is working, with the case count once known", () => {
    expect(progressLine(impr({ status: "promoted" }))).toBeNull();
    expect(progressLine(impr({ status: "replaying" }))).toBe("Learning… replaying past cases");
    const replay = { attempts: 1, fixed: false, regressions: 0, cases: [1, 2, 3].map(() => ({ label: "c", expected: "flag" as const, before: "pass" as const, after: "pass" as const })) };
    expect(progressLine(impr({ status: "replaying", replay }))).toBe("Learning… replaying 3 past cases again");
  });

  test("a technique's source", () => {
    const t = { key: "t", sourceKind: "taught", improvementKey: "impr_1", status: "active" } as FraudTechnique;
    expect(techniqueSource(t, [impr({ trigger: { kind: "taught", text: "", by: "dev" } })], names)).toEqual({ text: "Taught by", person: "Dev Okafor", billKey: null });
    expect(techniqueSource({ ...t, sourceKind: "seed" }, [], names).text).toBe("Starting playbook");
    expect(techniqueSource({ ...t, sourceKind: "missed_scam", sourceRef: "bill_1" }, [], names)).toEqual({
      text: "Learned from a missed scam on INV-4502 · Stagecraft Rigging Co.",
      person: null,
      billKey: "bill_1",
    });
    expect(countWord(0)).toBe("No");
    expect(countWord(14)).toBe("14");
  });
});
