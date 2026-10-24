import * as React from "react";
import { Amount } from "@/components/callback";
import { TemplateSwitch } from "@/components/TemplateSwitch";
import { COMPANIES, cap, capital, inSentence } from "@/lib/company";
import { getCompany } from "@/lib/data";
import { getPersona } from "@/lib/persona";

export const metadata = { title: "Workspace · hold" };

/** Who hold works for, and the other company templates the same engine runs. */
export default async function WorkspacePage(): Promise<React.ReactElement> {
  const [co, persona] = await Promise.all([getCompany(), getPersona()]);

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-head">
        <div className="pt-head-text">
          <h1 className="cb-display">Workspace</h1>
          <p className="pt-sub">
            hold works for {co.name}. The same checks, calls and sign-offs run for any company that pays people; loading a template replaces its{" "}
            {co.payee.many}, {co.bill.many} and calls, and keeps the playbooks hold has learned.
          </p>
        </div>
      </header>

      <div className="grid gap-4 min-[1101px]:grid-cols-3">
        {Object.values(COMPANIES).map((c) => (
          <article key={c.key} className="cb-doc flex flex-col">
            <div className="cb-doc-head">
              <span>{c.name}</span>
              <small>{c.dept}</small>
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <p className="m-0 font-mono text-[12.5px]/[19px] text-ink">{cap(c.about.replace(/^[^,]+, /, ""))}.</p>
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-[13px]/[19px]">
                <dt className="cb-caps pt-0.5">Pays</dt>
                <dd className="m-0 text-ink">
                  {capital(c.payee).many}: {Object.values(c.categories).join(", ").toLowerCase()}
                </dd>
                <dt className="cb-caps pt-0.5">Signs off</dt>
                <dd className="m-0 text-ink">
                  <span className="font-serif italic text-signatory">{c.dev.full}</span>, {inSentence(c.dev.role)}, on {c.bill.many} of{" "}
                  <Amount cents={c.approvalLimitCents} /> or more
                </dd>
                <dt className="cb-caps pt-0.5">Works the queue</dt>
                <dd className="m-0 text-ink">
                  <span className="font-serif italic text-signatory">{c.maya.full}</span>, {inSentence(c.maya.role)}
                </dd>
              </dl>
              <div className="mt-auto pt-2">
                <TemplateSwitch company={c.key} name={c.name} current={c.key === co.key} actor={persona} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
