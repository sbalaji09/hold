"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cx } from "@/components/callback/cx";
import type { ActivityActor } from "@/lib/types";

const ACTORS: Array<{ value: ActivityActor; label: string }> = [
  { value: "callback", label: "hold" },
  { value: "dev", label: "You" },
];

export function ActivityFilters(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const actor = searchParams.get("actor") ?? "";

  function update(next: { q?: string; actor?: string }): void {
    const params = new URLSearchParams(searchParams.toString());
    const q2 = next.q ?? q;
    const actor2 = next.actor ?? actor;
    if (q2) params.set("q", q2);
    else params.delete("q");
    if (actor2) params.set("actor", actor2);
    else params.delete("actor");
    router.push(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex items-center gap-3">
      <input
        type="search"
        value={q}
        onChange={(e) => update({ q: e.target.value })}
        placeholder="Search the log"
        aria-label="Search the log"
        className="flex-1 rounded-sm border border-line bg-surface px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-faint"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => update({ actor: "" })}
          className={cx(
            "cb-caps rounded-xs px-2 py-1",
            actor === "" ? "bg-ink text-on-action" : "text-ink-muted hover:bg-surface-hover",
          )}
        >
          Everyone
        </button>
        {ACTORS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => update({ actor: actor === a.value ? "" : a.value })}
            className={cx(
              "cb-caps rounded-xs px-2 py-1",
              actor === a.value ? "bg-ink text-on-action" : "text-ink-muted hover:bg-surface-hover",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
