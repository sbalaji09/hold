"use client";
// The sidebar's company box: shows who hold works for and opens a menu of every template.
// Picking another one asks first, because loading it replaces every bill, payee and call.
import * as React from "react";
import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/callback";
import { COMPANIES, type CompanyKey } from "@/lib/company";
import { SWITCH_OFF_REASON, useTemplateLoader } from "./TemplateSwitch";

export function WorkspaceSwitcher({ current, actor }: { current: CompanyKey; actor: "maya" | "dev" }) {
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<CompanyKey | null>(null);
  const { allowed, pending, error, run } = useTemplateLoader(actor);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const co = COMPANIES[current];

  const close = React.useCallback(() => {
    setOpen(false);
    setPicked(null);
  }, []);

  // Click outside or Escape closes the menu, and focus goes back to the box.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const target = picked ? COMPANIES[picked] : null;

  return (
    <div className="pt-switcher" ref={boxRef}>
      <button
        ref={triggerRef}
        type="button"
        className="pt-workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="pt-workspace-text">
          <b>{co.name}</b>
          <span>{co.dept}</span>
        </span>
        <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden />
      </button>

      {open ? (
        <div className="pt-switcher-menu" role="menu" aria-label="Company">
          {target ? (
            <div className="pt-switcher-confirm" role="group" aria-label={`Load ${target.name}`}>
              <p className="pt-switcher-say">
                Load {target.name}? This replaces {co.name}&apos;s {co.payee.many}, {co.bill.many} and calls with {target.name}&apos;s. The playbooks hold
                learned stay.
              </p>
              {error ? (
                <p className="pt-switcher-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="pt-switcher-buttons">
                <Button variant="primary" size="sm" autoFocus disabled={pending !== null} onClick={async () => (await run(target.key)) && close()}>
                  {pending ? "Loading…" : `Load ${target.name}`}
                </Button>
                <Button size="sm" disabled={pending !== null} onClick={() => setPicked(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {Object.values(COMPANIES).map((c) => {
                const here = c.key === current;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={here}
                    className="pt-switcher-item"
                    disabled={!here && allowed !== true}
                    title={!here && allowed === false ? SWITCH_OFF_REASON : undefined}
                    onClick={() => (here ? close() : setPicked(c.key))}
                  >
                    <span className="pt-workspace-text">
                      <b>{c.name}</b>
                      <span>{c.dept}</span>
                    </span>
                    {here ? <Check size={14} strokeWidth={1.5} aria-hidden /> : null}
                  </button>
                );
              })}
              {allowed === false ? <p className="pt-switcher-note">{SWITCH_OFF_REASON}</p> : null}
              <Link href="/workspace" className="pt-switcher-link" onClick={close}>
                About these templates
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
