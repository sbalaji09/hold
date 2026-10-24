import type * as React from "react";

/** Shown at once on a navigation the router hasn't cached yet, instead of the old page freezing. */
export default function Loading(): React.ReactElement {
  return (
    <div className="flex flex-col gap-4" data-loading>
      <div className="cb-doc p-4 font-mono text-[13px] text-ink-muted" role="status">
        <span className="cb-dots">Loading</span>
      </div>
    </div>
  );
}
