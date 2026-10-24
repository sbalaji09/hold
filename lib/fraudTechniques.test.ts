import { describe, expect, test } from "vitest";
import { promotion, replaySummary, scoreReplay, SEED_PLAYBOOK, techniqueCheck, type ReplayCase, type Technique } from "./fraudTechniques";

const PORTAL: Technique = { key: "tech_portal", name: "Payment link or portal", howItWorks: "", signals: [], example: "" };
const none = { suspicious: false, name: "", quote: "", why: "" };

describe("techniqueCheck", () => {
  test("a known technique flags with its name and the words that show it", () => {
    const c = techniqueCheck(
      { matches: [{ techniqueKey: "tech_portal", quote: "pay at pay-stagecraft.com", why: "It moves payment to a new web portal" }], novel: none },
      [PORTAL],
      "rosa@stagecraftrigging.com",
    );
    expect(c).toMatchObject({ id: "fraud-technique", state: "flag", quote: "pay at pay-stagecraft.com" });
    expect(c.evidence).toBe('Matches "Payment link or portal". It moves payment to a new web portal.');
  });

  test("a technique hold has never seen still flags, named as new", () => {
    const c = techniqueCheck({ matches: [], novel: { suspicious: true, name: "escrow redirect", quote: "via escrow", why: "Pays an escrow agent instead" } }, [PORTAL], "x@y.com");
    expect(c.state).toBe("flag");
    expect(c.evidence).toContain("hasn't seen before (escrow redirect)");
  });

  test("a match on a technique that isn't in the playbook is ignored", () => {
    expect(techniqueCheck({ matches: [{ techniqueKey: "tech_gone", quote: "", why: "" }], novel: none }, [PORTAL], "x@y.com").state).toBe("pass");
  });

  test("a clean email passes and says how many techniques it was checked against", () => {
    expect(techniqueCheck({ matches: [], novel: none }, [PORTAL], "x@y.com").evidence).toContain("any of the 1 fraud techniques");
  });
});

describe("replay gate", () => {
  const c = (label: string, expected: "flag" | "pass", before: "flag" | "pass", after: "flag" | "pass", trigger = false): ReplayCase => ({ label, expected, before, after, trigger });

  test("promotes a tightening change that fixes the case with no regressions", () => {
    const score = scoreReplay([c("trigger", "flag", "pass", "flag", true), c("scam", "flag", "flag", "flag"), c("bill", "pass", "pass", "pass")]);
    expect(score).toEqual({ fixed: true, regressions: [] });
    expect(promotion("missed_scam", score)).toBe("promote");
    expect(promotion("taught", score)).toBe("promote");
  });

  test("a loosening change (false alarm) always waits for Dev", () => {
    expect(promotion("false_alarm", scoreReplay([c("trigger", "pass", "flag", "pass", true)]))).toBe("needs_approval");
  });

  test("breaking a case the old playbook got right is a regression; one it already got wrong isn't", () => {
    const score = scoreReplay([
      c("trigger", "flag", "pass", "flag", true),
      c("paid bill A", "pass", "pass", "flag"), // newly wrong: regression
      c("paid bill B", "pass", "flag", "flag"), // was already wrong: not this change's fault
    ]);
    expect(score.regressions.map((r) => r.label)).toEqual(["paid bill A"]);
    expect(promotion("missed_scam", score)).toBe("retry");
    expect(replaySummary([c("trigger", "flag", "pass", "flag", true), c("paid bill A", "pass", "pass", "flag")], score)).toBe(
      "Replayed on 1 past case plus the new one: handles the new case, 1 regression (paid bill A).",
    );
  });

  test("not fixing the case means no promotion, even with no regressions", () => {
    expect(promotion("missed_scam", scoreReplay([c("trigger", "flag", "pass", "pass", true)]))).toBe("retry");
  });
});

test("the starting playbook has distinct, complete techniques", () => {
  expect(new Set(SEED_PLAYBOOK.map((t) => t.name)).size).toBe(SEED_PLAYBOOK.length);
  for (const t of SEED_PLAYBOOK) {
    expect(t.howItWorks.length).toBeGreaterThan(20);
    expect(t.signals.length).toBeGreaterThan(0);
  }
});
