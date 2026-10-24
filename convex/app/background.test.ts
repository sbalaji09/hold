import { expect, test } from "vitest";
import { backgroundLocal, copycatLocal, editDistance, extractPhones, similarity } from "./background.js";

test("editDistance counts the minimum single-character edits", () => {
  expect(editDistance("stagecraft", "stagecraft")).toBe(0);
  expect(editDistance("stagecraft", "stagekraft")).toBe(1);
  expect(editDistance("", "abc")).toBe(3);
});

test("similarity is 1 for identical strings and drops for lookalike domains", () => {
  expect(similarity("stagecraftrigging.com", "stagecraftrigging.com")).toBe(1);
  const lookalike = similarity("stagecraft-rigging.com", "stagecraftrigging.com");
  expect(lookalike).toBeGreaterThan(0.8);
  expect(lookalike).toBeLessThan(1);
  expect(similarity("stagecraftrigging.com", "totallydifferentco.net")).toBeLessThan(0.5);
});

test("extractPhones finds US-style numbers in free text and dedupes", () => {
  const text = "Call us at (415) 555-0199 or (415) 555-0199 for support. Fax: 415.555.0200";
  const phones = extractPhones(text);
  expect(phones).toContain("(415) 555-0199");
  expect(phones).toContain("415.555.0200");
  expect(phones.length).toBe(2);
});

test("extractPhones returns nothing when there's no number in the text", () => {
  expect(extractPhones("Reach out any time, we're around.")).toEqual([]);
});

test("backgroundLocal flags an invalid domain without fetching", async () => {
  const { findings } = await backgroundLocal("not a domain");
  expect(findings).toEqual([{ label: "Site reachable", state: "flag", evidence: `"not a domain" isn't a valid domain to check.` }]);
});

test("copycatLocal flags an invalid domain without fetching", async () => {
  const { findings } = await copycatLocal("http://evil.example/../", "stagecraftrigging.com");
  expect(findings[0]?.state).toBe("flag");
});
