"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";

interface WatchOnlyToggleProps {
  watchOnly: boolean;
}

export function WatchOnlyToggle({ watchOnly }: WatchOnlyToggleProps): React.ReactElement {
  const router = useRouter();
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const setWatchOnly = useMutation(api.app.mutations.setWatchOnly);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    if (!convexConfigured) {
      setError("Convex isn't connected. This setting needs the backend.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await setWatchOnly({ watchOnly: !watchOnly, actor: "dev" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change Watch only.");
    } finally {
      setPending(false);
    }
  }

  if (!convexConfigured) {
    return <Button variant="secondary" locked="Watch only is off. Convex isn't connected, so this setting is read-only." size="sm">Watch only</Button>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" disabled={pending} onClick={toggle}>
        {"Watch only: " + (watchOnly ? "on" : "off")}
      </Button>
      {error ? <p className="font-mono text-[12px] text-hold-solid">{error}</p> : null}
    </div>
  );
}
