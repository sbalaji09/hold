"use client";
// Today's "On the line" section: the check call hold is on right now, live from Convex, and
// whether it is waiting on a person to judge an answer.
import * as React from "react";
import Link from "next/link";
import { StatusMark } from "@/components/callback";
import { liveCallPath, useActiveCall } from "@/components/voice";
import { useLiveCall } from "@/components/voice/api";
import { openAsk } from "@/components/voice/AskPerson";
import { formatPhone } from "@/components/voice/format";

export function LiveNow(): React.ReactElement {
  const active = useActiveCall();
  const call = useLiveCall(active?.call_id);

  if (!active) {
    return <p className="pt-dash-empty">No call right now. hold opens the live call here the moment one starts.</p>;
  }
  const who = call?.supplier?.name ?? active.supplier_id;
  const asking = call ? openAsk(call.events) : null;
  return (
    <Link href={liveCallPath(active.call_id)} className="pt-dash-row">
      <span className="pt-dash-text">
        <span className="pt-dash-title">
          {active.status === "dialing" ? "Ringing" : "On a call with"} {who}
        </span>
        <span className="pt-dash-line">
          {asking ? "hold is asking you about an answer. Open the call." : `${formatPhone(active.to_number)} · ${active.reason.join(" · ")}`}
        </span>
      </span>
      <span className="pt-dash-right">
        <StatusMark status={asking ? "needs-you" : "calling"} />
      </span>
    </Link>
  );
}
