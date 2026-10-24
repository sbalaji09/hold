"use client";
// Loading a company template: on the Workspace screen (TemplateSwitch) and from the sidebar's
// switcher (WorkspaceSwitcher). Loading replaces every bill, payee and call, so it is off unless
// Convex allows it, and the sidebar asks before it runs.
import * as React from "react";
import { useRouter } from "next/navigation";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/callback";
import type { CompanyKey } from "@/lib/company";

export const SWITCH_OFF_REASON = "Switching is off: it replaces every bill, payee and call. Set ALLOW_TEMPLATE_SWITCH=true in the Convex env.";

/** Loads a template and returns to Today. `allowed` is undefined while Convex answers. */
export function useTemplateLoader() {
  const router = useRouter();
  const load = useMutation(api.app.workspace.loadTemplate);
  const allowed = useQuery(api.app.workspace.templateSwitch, {})?.allowed;
  const [pending, setPending] = React.useState<CompanyKey | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(company: CompanyKey): Promise<boolean> {
    setPending(company);
    setError(null);
    try {
      await load({ company, actor: "dev" });
      router.push("/");
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ConvexError ? String(err.data) : err instanceof Error ? err.message : "Couldn't load the template.");
      return false;
    } finally {
      setPending(null);
    }
  }

  return { allowed, pending, error, run };
}

export function TemplateSwitch({ company, name, current }: { company: CompanyKey; name: string; current: boolean }) {
  const { allowed, pending, error, run } = useTemplateLoader();

  if (current) return <Button variant="secondary" size="sm" locked={`This workspace is ${name} now.`}>Loaded</Button>;
  if (allowed === false) {
    return (
      <Button variant="secondary" size="sm" locked={SWITCH_OFF_REASON}>
        Load {name}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant="primary" size="sm" disabled={pending !== null || allowed === undefined} onClick={() => run(company)}>
        {pending ? `Loading ${name}…` : `Load ${name}`}
      </Button>
      {error ? <p className="m-0 font-mono text-[12px] text-hold">{error}</p> : null}
    </div>
  );
}
