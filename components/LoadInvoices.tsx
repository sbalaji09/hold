"use client";
// Inbox/Today's "Load invoices": one click replays the pending batch (data/incoming.json)
// through the real intake path, staggered server-side (convex/app/loadIncoming.ts). Idempotent:
// once loaded, the button stays disabled. A live "Checking N…" indicator shows while any bill
// from the batch is still being checked.
import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";
import { SendBill } from "@/components/SendBill";

export function LoadInvoices({ billLabel }: { billLabel: string }): React.ReactElement {
  const status = useQuery(api.app.loadIncoming.incomingStatus, {});
  const bills = useQuery(api.app.queries.listBills, {});
  const start = useMutation(api.app.loadIncoming.startLoadIncoming);
  const [pending, setPending] = React.useState(false);

  const loaded = status?.loaded ?? false;
  const checking = (bills ?? []).filter((b) => b.status === "Checking").length;

  async function onClick() {
    setPending(true);
    try {
      await start({});
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {checking > 0 ? <span className="cb-caps text-ink-muted">Checking {checking} invoice{checking === 1 ? "" : "s"}…</span> : null}
      <SendBill label={`Write your own ${billLabel}`} />
      <Button variant="primary" disabled={loaded || pending || status === undefined} onClick={onClick}>
        {loaded ? "Invoices loaded" : pending ? "Loading…" : "Load invoices"}
      </Button>
    </div>
  );
}
