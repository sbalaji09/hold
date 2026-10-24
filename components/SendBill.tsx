"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TryAScam } from "@/components/TryAScam";

/** "Send a bill" button + modal. The form closes on Send; intake runs in the background and the page refreshes when it lands. */
export function SendBill({ label }: { label: string }): React.ReactElement {
  const ref = React.useRef<HTMLDialogElement>(null);
  const router = useRouter();
  return (
    <>
      <button type="button" className="cb-btn cb-btn-secondary" onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref} className="m-auto w-[min(640px,92vw)] rounded-md bg-surface p-0 shadow-pop backdrop:bg-black/30">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="cb-caps text-ink">Send a bill</h2>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="text-ink-muted hover:text-ink">
            ✕
          </button>
        </div>
        <TryAScam
          onStart={() => ref.current?.close()}
          onFail={() => ref.current?.showModal()}
          onDone={() => router.refresh()}
        />
      </dialog>
    </>
  );
}
