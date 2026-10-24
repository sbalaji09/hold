// Pure helpers of convex/app/onboarding.ts, in their own file: the end-to-end tests mock Claude,
// and importing the module there first would load it before the mock applies.
import { describe, expect, test } from "vitest";
import { lookalikeOf, toE164 } from "./onboarding.js";

const STAGE = { key: "sup_stage", name: "Stagecraft Rigging Co.", domain: "stagecraftrigging.com" };

describe("helpers", () => {
  test("toE164 reads the usual ways people write a US number", () => {
    expect(["(628) 555-0143", "628.555.0143", "+1 628 555 0143", "16285550143"].map(toE164)).toEqual(Array(4).fill("+16285550143"));
    expect(toE164("555-0143")).toBeNull();
  });

  test("lookalikeOf catches imitations of a known supplier, not newcomers", () => {
    const known = [STAGE];
    expect(lookalikeOf("stagecraft-rigging.co", known)).toMatchObject({ key: "sup_stage" });
    expect(lookalikeOf("stagecraftriging.com", known)).toMatchObject({ key: "sup_stage" });
    expect(lookalikeOf("stagecraftrigging.net", known)).toMatchObject({ key: "sup_stage" });
    expect(lookalikeOf("lumenstage.com", known)).toBeNull();
    expect(lookalikeOf("stagecraftrigging.com", known)).toBeNull(); // the supplier itself
  });
});

