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
        <TryAScam
          onStart={() => ref.current?.close()}
          onFail={() => ref.current?.showModal()}
          onDone={() => router.refresh()}
        />
      </dialog>
    </>
  );
}
