import type { MouseEventHandler, ReactNode } from "react";

export interface CiteProps {
  href?: string;
  onClick?: MouseEventHandler;
  children: ReactNode;
}

/** Port of design/callback Cite: a reference to the record a claim came from. */
export function Cite({ href, onClick, children }: CiteProps) {
  // No record page yet: render the reference without a dead link.
  if (!href && !onClick) return <span className="cb-cite">{children}</span>;
  return (
    <a className="cb-cite" href={href ?? "#"} onClick={onClick}>
      {children}
    </a>
  );
}
