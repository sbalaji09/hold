"use client";
// Today's header: the approver says they're out. While away, hold never puts a supplier on hold to
// ask them mid-call; answers it can't judge wait in "Needs your approval" instead.

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";

export function AwayToggle({ away }: { away: boolean }): React.ReactElement {
  const router = useRouter();
  const setAway = useMutation(api.app.mutations.setAway);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <Button variant="secondary" size="sm" locked="Convex isn't connected, so this setting is read-only.">Available</Button>;
  }

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      await setAway({ away: !away, actor: "dev" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change that.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" disabled={pending} onClick={toggle} aria-pressed={away}>
        {away ? "Away: hold won't ask you during calls" : "Available for hold's questions"}
      </Button>
      {error ? <p className="font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </div>
  );
}
