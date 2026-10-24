import { expect, test } from "vitest";
import { buildPrompt } from "./pushback.js";

test("buildPrompt quotes the call evidence, names the failed check and offers the old account", () => {
  const prompt = buildPrompt({
    invoiceNo: "4471",
    supplierName: "Stagecraft Rigging Co.",
    amountCents: 1_840_000,
    devText: "Release it, we'll miss the stage build.",
    call: {
      summary: "Supplier says they never changed bank details.",
      outcome: "not_confirmed",
      turns: [{ ask: "Did you recently change your bank account?", answer: "No, we never changed our bank.", matches: false }],
      clip: { start_s: 41, end_s: 47 },
    },
    oldAccount: { bank: "Chase", last4: "2210" },
  });

  expect(prompt).toContain("Stagecraft Rigging Co.");
  expect(prompt).toContain("$18,400.00");
  expect(prompt).toContain("No, we never changed our bank.");
  expect(prompt).toContain("Clip available at 41s-47s.");
  expect(prompt).toContain("Chase ··2210");
  expect(prompt).toContain("Release it, we'll miss the stage build.");
});

test("buildPrompt handles no recorded Q&A and no clip", () => {
  const prompt = buildPrompt({
    invoiceNo: "100",
    supplierName: "Acme",
    amountCents: 100,
    devText: "Pay it.",
    call: { summary: "No answer.", outcome: "handed_off", turns: [], clip: null },
    oldAccount: { bank: "Wells Fargo", last4: "0001" },
  });

  expect(prompt).toContain("(no recorded Q&A)");
  expect(prompt).toContain("No clip recorded.");
});
