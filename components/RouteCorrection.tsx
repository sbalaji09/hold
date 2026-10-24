"use client";
// Telling hold it sorted an email wrong: pick where it belongs, read what happens, confirm. Shared
// by a message's "Sorted wrong" and a bill's "Not a bill" (convex/app/triage.ts).
import * as React from "react";
import { Button } from "@/components/callback";
import { errorText } from "@/components/Playbook";
import { ROUTE_WORDS, type Route } from "@/lib/triage";

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function RouteCorrection<R extends Route>({
  id,
  label,
  intro,
  options,
  current,
  consequence,
  confirmLabel,
  onMove,
}: {
  id: string;
  label: string;
  intro: string;
  options: R[];
  /** Where it is now: shown, but can't be picked. */
  current?: Route;
  consequence: (r: R) => string;
  confirmLabel: string;
  /** Does the move; resolves to the line to show once it's done. */
  onMove: (r: R) => Promise<React.ReactNode>;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState<R | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<React.ReactNode>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setChoice(null);
    setError(null);
    triggerRef.current?.focus();
  }

  async function go() {
    if (!choice) return;
    setError(null);
    setPending(true);
    try {
      setResult(await onMove(choice));
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "hold couldn't record that just now. Try again in a minute."));
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <p role="status" className="max-w-[260px] font-mono text-[12px]/[18px] text-ink-muted">
        {result}
      </p>
    );
  }

  return (
    <div className="relative" onKeyDown={(e) => e.key === "Escape" && open && close()}>
      <Button ref={triggerRef} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-controls={id}>
        {label}
      </Button>
      {open ? (
        <div id={id} role="dialog" aria-label={label} className="absolute right-0 top-full z-10 mt-2 w-[340px] rounded-md bg-surface p-4 shadow-pop max-[760px]:fixed max-[760px]:inset-x-4 max-[760px]:top-auto max-[760px]:w-auto">
          <fieldset className="m-0 border-0 p-0">
            <legend className="cb-caps p-0">{label}</legend>
            <p className="mt-2 text-[13px]/[20px] text-ink">{intro}</p>
            <div className="mt-3 flex flex-col gap-1">
              {options.map((r) => {
                const here = r === current;
                return (
                  <label
                    key={r}
                    className={`flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13.5px] ${here ? "text-ink-muted" : "cursor-pointer text-ink hover:bg-surface-hover"}`}
                  >
                    <input
                      type="radio"
                      name={`${id}-route`}
                      value={r}
                      checked={choice === r}
                      disabled={here || pending}
                      onChange={() => setChoice(r)}
                      className="accent-ink"
                    />
                    <span>
                      {capitalise(ROUTE_WORDS[r])}
                      {here ? <span className="font-mono text-[11.5px]"> &middot; where it is now</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {choice ? (
            <p className="mt-3 border-t border-dashed border-line pt-3 font-mono text-[12px]/[18px] text-ink">{consequence(choice)}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 font-mono text-[12px] text-hold">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={go} disabled={pending || !choice}>
              {pending ? "Moving…" : confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
