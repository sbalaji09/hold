import * as React from "react";
import type { Metadata } from "next";
import { Guilloche } from "@/components/callback";
import { getCompany } from "@/lib/data";
import "./card.css";

export const metadata: Metadata = { title: "Judge card · hold" };

/** "+14155550142" -> "(415) 555-0142". Anything that isn't a US E.164 number is shown as given. */
function formatPhone(number: string): string {
  const d = number.replace(/\D/g, "").slice(-10);
  if (d.length < 10) return number;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default async function CardPage(): Promise<React.ReactElement> {
  const co = await getCompany();
  const phone = process.env.TWILIO_PHONE_NUMBER;
  const email = process.env.INBOUND_EMAIL_ADDRESS;

  return (
    <div className="card-page">
      <div className="cb-doc card-sheet">
        <div className="card-brand">
          <Guilloche size={30} lobes={9} strands={6} className="card-seal" />
          <div>
            <div className="pt-word">hold</div>
            <div className="cb-caps">{co.name} · {co.dept}</div>
          </div>
        </div>

        <h1 className="cb-display">Judge card</h1>

        <div className="card-kv">
          <span className="cb-caps">Call {co.owner} line</span>
          <span className="pt-statement">{phone ? formatPhone(phone) : "Number not set yet"}</span>
        </div>

        <div className="card-kv">
          <span className="cb-caps">Email the {co.dept.toLowerCase()} inbox</span>
          <span className="pt-statement">{email || "Address not set yet"}</span>
        </div>

        <p className="pt-small card-note">
          Pretend to be {co.payee.one === "employee" ? "an" : "a"} {co.payee.one} asking to change bank details. hold will not change anything from that
          call or email alone; it calls back on the number already on file before it acts.
        </p>
      </div>
    </div>
  );
}
