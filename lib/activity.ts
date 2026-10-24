// Activity log needs each entry to link to the bill it touched. listActivity()
// gives bill/bankAccount refs; bankAccount refs resolve through the bill that
// currently holds that account. Kept separate so lib/data.ts stays untouched.

import { listActivity, listBills } from "./data";
import type { ActivityEntry } from "./types";

export interface ActivityEntryWithHref extends ActivityEntry {
  href: string;
}

export async function listActivityWithLinks(): Promise<ActivityEntryWithHref[]> {
  const [entries, bills] = await Promise.all([listActivity(), listBills()]);
  const billKeyByBankAccount: Record<string, string> = {};
  for (const b of bills) billKeyByBankAccount[b.bankAccount.key] = b.key;
  return entries.map((entry) => {
    const billKey = entry.refKind === "bill" ? entry.refKey : billKeyByBankAccount[entry.refKey];
    return { ...entry, href: billKey ? `/bills/${billKey}` : "/" };
  });
}
