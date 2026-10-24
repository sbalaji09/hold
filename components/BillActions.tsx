"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";
import type { PolicyResult } from "@/lib/policy";
import { useCompany } from "@/lib/useCompany";

interface BillActionsProps {
  billKey: string;
  amount: string;
  pay: PolicyResult;
  hold: PolicyResult;
  call: PolicyResult;
}

export function BillActions({ billKey, amount, pay, hold, call }: BillActionsProps): React.ReactElement {
  const router = useRouter();
  const co = useCompany();
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const payBill = useMutation(api.app.mutations.payBill);
  const holdBill = useMutation(api.app.mutations.holdBill);
  const requestCall = useMutation(api.app.mutations.requestCall);
  const [pending, setPending] = React.useState<"pay" | "hold" | "call" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: "pay" | "hold" | "call") {
    if (!convexConfigured) {
      setError("Convex isn't connected. This action needs the backend.");
      return;
    }
    setError(null);
    setPending(action);
    try {
      const res = action === "pay" ? await payBill({ billKey }) : action === "hold" ? await holdBill({ billKey }) : await requestCall({ billKey });
      if (res && typeof res === "object" && "refused" in res) setError(res.refused);
      router.refresh();
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : err instanceof Error ? err.message : "Callback couldn't do that just now.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-start gap-2.5">
        {call.allowed ? (
          <Button variant="secondary" icon="phone" disabled={pending !== null} onClick={() => run("call")}>
            {pending === "call" ? "Calling…" : `Call ${co.payee.one}`}
          </Button>
        ) : (
          <Button variant="secondary" icon="phone" locked={call.reason}>
            Call {co.payee.one}
          </Button>
        )}
        {hold.allowed ? (
          <Button variant="hold" icon="hold" disabled={pending !== null} onClick={() => run("hold")}>
            {pending === "hold" ? "Holding…" : "Hold"}
          </Button>
        ) : (
          <Button variant="hold" icon="hold" locked={hold.reason}>
            Hold
          </Button>
        )}
        {pay.allowed ? (
          <Button variant="primary" disabled={pending !== null} onClick={() => run("pay")}>
            {pending === "pay" ? "Paying…" : "Pay " + amount}
          </Button>
        ) : (
          <Button variant="primary" locked={pay.reason}>
            {"Pay " + amount}
          </Button>
        )}
      </div>
      {error ? <p className="font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </div>
  );
}
