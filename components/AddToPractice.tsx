"use client";
import * as React from "react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Button } from "@/components/callback";

// convex/app/practice.ts's addToPracticeSet isn't in the regenerated `api`
// object yet, so it's addressed by name.
const addToPracticeSetRef = makeFunctionReference<"mutation", { billKey: string }, { key: string }>(
  "app/practice:addToPracticeSet",
);

export function AddToPractice({ billKey }: { billKey: string }): React.ReactElement {
  const addToPracticeSet = useMutation(addToPracticeSetRef);
  const [state, setState] = React.useState<"idle" | "pending" | "done" | "error">("idle");

  async function onClick() {
    setState("pending");
    try {
      await addToPracticeSet({ billKey });
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return <span className="font-mono text-[12px] text-ink-muted">Added to practice set</span>;
  }

  return (
    <Button onClick={onClick} disabled={state === "pending"}>
      {state === "pending" ? "Adding…" : state === "error" ? "Couldn't add — try again" : "Add to practice set"}
    </Button>
  );
}
