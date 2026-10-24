"use client";
// Bill page: the email isn't a bill (a reminder, a schedule update). hold holds the bill so it
// can't be paid, records where the email belongs, and learns (convex/app/triage.ts notABill).
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { RouteCorrection } from "@/components/RouteCorrection";
import { ROUTE_WORDS } from "@/lib/triage";
import { useCompany } from "@/lib/useCompany";

export function NotABill({ billKey, supplier, actor }: { billKey: string; supplier: string; actor: "maya" | "dev" }): React.ReactElement {
  const notABill = useMutation(api.app.triage.notABill);
  const co = useCompany();
  const router = useRouter();
  return (
    <RouteCorrection
      id="not-a-bill"
      label={`Not a ${co.bill.one}`}
      intro="hold holds this bill so it can't be paid. Where does the email belong?"
      options={["to_maya", "file"]}
      consequence={(r) =>
        `${r === "file" ? `It's filed on ${supplier}'s record.` : `It's kept as a message for ${co.maya.name}.`} hold learns from the correction and replays it before it changes how it sorts.`
      }
      confirmLabel="Hold it"
      onMove={async (r) => {
        const res = await notABill({ billKey, route: r, actor });
        router.refresh();
        return (
          <>
            Held. The email is {ROUTE_WORDS[r]}.{" "}
            {res.key ? (
              <>
                hold is learning from it.
              </>
            ) : (
              "hold is already learning from it."
            )}
          </>
        );
      }}
    />
  );
}
