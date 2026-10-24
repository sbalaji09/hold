// One engine, three companies: limits, names and words come from the profile, not from Fogline.
import { describe, expect, test } from "vitest";
import { COMPANIES, companyFor } from "./company";
import { canPay, canRelease } from "./policy";
import { decide, routeEscalation, runChecks } from "../convex/app/checks";
import type { Bill } from "./types";

const { fogline, bayline, harbor } = COMPANIES;

const bill = (amountCents: number, status: Bill["status"] = "Checking") =>
  ({ status, amountCents, checks: [], supplier: { trustedPhone: "+14155550100" } }) as unknown as Bill;

describe("company profiles", () => {
  test("an unknown or missing key is Fogline", () => {
    expect(companyFor(undefined).key).toBe("fogline");
    expect(companyFor("nope").key).toBe("fogline");
  });

  test("each company's approval limit decides who pays", () => {
    expect(canPay(bill(900_000), false, fogline).allowed).toBe(true);
    expect(canPay(bill(1_200_000), false, fogline).reason).toBe("Callback can't pay this on its own. Bills of $10,000 or more need Dev's approval.");
    expect(canPay(bill(1_200_000), false, bayline).allowed).toBe(true);
    expect(canPay(bill(600_000), false, harbor).reason).toBe("Callback can't pay this on its own. Paychecks of $5,000 or more need Dana's approval.");
    expect(decide([], 600_000, harbor)).toBe("ask_dev");
    expect(decide([], 600_000, fogline)).toBe("pay");
    expect(routeEscalation([], 3_000_000, { company: bayline }).reason).toBe("$30,000.00 is over hold's $25,000 limit, so it needs Marcus's approval.");
  });

  test("a held release names the company's approver", () => {
    expect(canRelease(bill(100, "Held"), "callback", harbor).reason).toBe("Callback can't release a held payment. Dana has to approve it.");
  });

  test("payroll and escrow wording counts as a bank change, in the company's words", () => {
    const run = (body: string, co = harbor) =>
      runChecks({
        email: { body, fromAddress: "ana@harborhealth.org", fromDomain: "harborhealth.org" },
        supplier: { key: "emp_ana", name: "Ana Torres", domain: "harborhealth.org" },
        currentBankAccount: { bank: "Wells Fargo", last4: "1182", verifiedBy: "onboarding" },
        pastPaidBankAccounts: [{ bank: "Wells Fargo", last4: "1182" }],
        pastPaidAmounts: [210_000],
        amountCents: 210_000,
        company: co,
      })[0]!;
    const payroll = run("Hi, please update my direct deposit to my new Chime account before Friday.");
    expect(payroll.state).toBe("flag");
    expect(payroll.evidence).toBe("Harbor Health has paid Ana Torres 1 time, always to Wells Fargo ··1182. This email asks to change the account.");
    expect(run("Attached are the updated wire instructions for my proceeds.", bayline).state).toBe("flag");
    expect(run("Thanks for the paystub, all good.").state).toBe("pass");
  });
});
