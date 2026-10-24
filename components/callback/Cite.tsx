import * as React from "react";

export interface CiteProps {
  href?: string;
  onClick?: React.MouseEventHandler;
  children: React.ReactNode;
}

export function Cite(p: CiteProps): React.ReactElement {
  return (
    <a className="cb-cite" href={p.href || "#"} onClick={p.onClick}>
      {p.children}
    </a>
  );
}
