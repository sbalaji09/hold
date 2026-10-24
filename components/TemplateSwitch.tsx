"use client";
// One company template on the Workspace screen: load it, or say why it can't be loaded.
import * as React from "react";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";
import type { CompanyKey } from "@/lib/company";

export function TemplateSwitch({ company, name, current, actor }: { company: CompanyKey; name: string; current: boolean; actor: "maya" | "dev" }) {
  const router = useRouter();
  const load = useMutation(api.app.workspace.loadTemplate);
  const allowed = useQuery(api.app.workspace.templateSwitch, {})?.allowed;
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (current) return <Button variant="secondary" size="sm" locked={`This workspace is ${name} now.`}>Loaded</Button>;
  if (allowed === false) {
    return (
      <Button variant="secondary" size="sm" locked="Switching is off: it replaces every bill, payee and call. Set ALLOW_TEMPLATE_SWITCH=true in the Convex env.">
        Load {name}
      </Button>
    );
  }

  async function run() {
    setPending(true);
    setError(null);
    try {
      await load({ company, actor });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : "Couldn't load the template.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="primary" size="sm" disabled={pending || allowed === undefined} onClick={run}>
        {pending ? `Loading ${name}…` : `Load ${name}`}
      </Button>
      {error ? <p className="m-0 font-mono text-[12px] text-hold">{error}</p> : null}
    </div>
  );
}
