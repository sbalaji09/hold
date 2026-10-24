"use client";
import * as React from "react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Button } from "@/components/callback";

// convex/app/suppliers.ts is a sibling module the generated `api` object
// doesn't know about yet (it isn't regenerated until `npx convex dev`
// runs), so this is addressed by name rather than through `api.app...`.
const addSupplierRef = makeFunctionReference<"mutation", { name: string; domain: string; phone: string }, { key: string }>(
  "app/suppliers:add",
);

export function AddSupplierForm(): React.ReactElement {
  const addSupplier = useMutation(addSupplierRef);
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await addSupplier({ name, domain, phone });
      setName("");
      setDomain("");
      setPhone("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that supplier.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add supplier</Button>;
  }

  return (
    <form onSubmit={onSubmit} className="cb-doc flex flex-col gap-3 p-4">
      <div className="cb-doc-head">
        <span>Add a supplier</span>
      </div>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-sm border border-line bg-surface px-2 py-1.5 font-sans text-[13px] text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        Domain
        <input
          required
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="example.com"
          className="rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-[13px] text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
        Trusted phone
        <input
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+14155550100"
          className="rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-[13px] text-ink"
        />
      </label>
      {error ? <p className="text-[13px] text-hold-solid">{error}</p> : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add supplier"}
        </Button>
        <Button size="sm" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
