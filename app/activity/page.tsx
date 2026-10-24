import * as React from "react";
import Link from "next/link";
import { ActivityFilters } from "@/components/ActivityFilters";
import { LogEntry } from "@/components/callback";
import { listActivityWithLinks } from "@/lib/activity";
import type { ActivityActor } from "@/lib/types";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; actor?: string }>;
}): Promise<React.ReactElement> {
  const { q, actor } = await searchParams;
  const all = await listActivityWithLinks();
  const ACTOR_NAME: Record<ActivityActor, string> = { callback: "hold", dev: "You" };
  const query = (q ?? "").trim().toLowerCase();
  const actorFilter = actor as ActivityActor | undefined;

  const entries = all.filter((entry) => {
    if (actorFilter && entry.actor !== actorFilter) return false;
    if (!query) return true;
    const haystack = `${ACTOR_NAME[entry.actor]} ${entry.what} ${entry.why}`.toLowerCase();
    return haystack.includes(query);
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-head">
        <div className="pt-head-text">
          <h1 className="cb-display">Activity log</h1>
          <p className="pt-sub">
            Every action by hold and you: who, when, what, why.
          </p>
        </div>
      </header>

      <ActivityFilters />

      <div className="cb-doc" role="list">
        <div className="cb-doc-head">
          {query || actorFilter ? "Matching entries" : "All entries"}
          <small>{entries.length} of {all.length}</small>
        </div>
        {entries.length ? (
          entries.map((entry) => (
            <Link key={entry.key} href={entry.href} className="block hover:bg-surface-hover">
              <LogEntry actor={ACTOR_NAME[entry.actor]} time={fmtTime(entry.at)} why={entry.why}>
                {entry.what}
              </LogEntry>
            </Link>
          ))
        ) : (
          <div className="px-4 py-6 text-[13px] text-ink-muted">
            {query ? <>No entries match &ldquo;{q}&rdquo;.</> : "Nothing has happened yet."}
          </div>
        )}
      </div>
    </div>
  );
}
