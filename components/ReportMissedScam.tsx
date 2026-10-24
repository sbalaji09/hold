"use client";
// Bill page: a person tells hold it let a scam through. The bill joins the Practice set and hold
// starts learning from it (convex/app/techniques.ts reportMissedScam).
import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";
import { errorText } from "@/components/Playbook";

export function ReportMissedScam({ billKey, actor }: { billKey: string; actor: "maya" | "dev" }): React.ReactElement {
  const report = useMutation(api.app.techniques.reportMissedScam);
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function go() {
    setError(null);
    setPending(true);
    try {
      const r = await report({ billKey, actor });
      setResult(r.key ? "hold is learning from this bill. It's in the Practice set now." : "hold is already learning from this bill.");
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "Couldn't report it just now. Try again."));
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <p role="status" className="max-w-[220px] font-mono text-[12px]/[18px] text-ink-muted">
        {result} <a href="/practice#learned" className="text-ink underline underline-offset-4">See Practice</a>
      </p>
    );
  }

  return (
    <div className="relative" onKeyDown={(e) => e.key === "Escape" && open && close()}>
      <Button ref={triggerRef} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="report-missed">
        Report missed scam
      </Button>
      {open ? (
        <div id="report-missed" role="dialog" aria-label="Report missed scam" className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md bg-surface p-4 shadow-pop">
          <div className="cb-caps">Report missed scam</div>
          <p className="mt-2 text-[13px]/[20px] text-ink">
            hold adds this bill to the Practice set, works out what it missed, and replays the fix against past bills before it goes live.
          </p>
          {error ? (
            <p role="alert" className="mt-2 font-mono text-[12px] text-hold">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={go} disabled={pending} autoFocus>
              {pending ? "Reporting…" : "Report it"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
