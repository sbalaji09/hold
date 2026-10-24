// Guards the JSON fallback (data/fogline.json via lib/data.ts) so it never leaks the full
// routing/account numbers onto a BankAccount the way Convex's toBankAccount already doesn't.
import { describe, expect, test } from "vitest";
import { listApprovals, listBankAccountsForSupplier, listBills, listSuppliers } from "./data";

function assertNoFullNumbers(rows: unknown[]) {
  for (const row of rows) {
    expect(JSON.stringify(row)).not.toMatch(/"accountNumber"|"routingNumber"/);
  }
}

describe("JSON fallback strips full bank account numbers", () => {
  test("listBills", async () => {
    assertNoFullNumbers(await listBills());
  });

  test("listApprovals", async () => {
    assertNoFullNumbers(await listApprovals());
  });

  test("listBankAccountsForSupplier", async () => {
    const suppliers = await listSuppliers();
    assertNoFullNumbers(await listBankAccountsForSupplier(suppliers[0].key));
  });
});
