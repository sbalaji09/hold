import { expect, test } from "vitest";
import { permutations, pool } from "./lookalikes.js";

test("covers the look-alikes scammers actually register, never the real domain", () => {
  const found = new Map(permutations("stagecraftrigging.com").map((p) => [p.domain, p.technique]));
  expect(found.get("stagecraft-rigging.com")).toBe("added hyphen");
  expect(found.get("stagecraftriging.com")).toBe("missing letter");
  expect(found.get("stagecraftrigging.co")).toBe("different ending");
  expect(found.get("stagecraftrigglng.com")).toBe("look-alike letter");
  expect(found.get("stagecraftrigging-billing.com")).toBe("added word");
  expect(found.has("stagecraftrigging.com")).toBe(false);
  expect([...found.keys()].every((d) => !d.startsWith("-") && !d.includes("-."))).toBe(true);
});

test("a hyphenated domain also gets its hyphen dropped", () => {
  expect(permutations("bay-line.com").some((p) => p.domain === "bayline.com")).toBe(true);
});

test("pool keeps order", async () => {
  expect(await pool([3, 1, 2], 2, async (n) => n * 10)).toEqual([30, 10, 20]);
});
