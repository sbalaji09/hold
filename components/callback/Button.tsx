import * as React from "react";
import { cx } from "./cx";
import { G, type GlyphName } from "./glyphs";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "hold" | "ask";
  size?: "md" | "sm";
  icon?: "phone" | "hold" | "tick" | "lock" | "clock" | "person";
  /** Why this can't be pressed, and who can. */
  locked?: string;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button(p: ButtonProps): React.ReactElement {
  const v = p.variant || "secondary";
  const { variant: _variant, size, locked, icon, className, children, ...rest } = p;
  const cls = v === "ask" ? cx("cb-ask", className) : cx("cb-btn", "cb-btn-" + v, size === "sm" && "cb-btn-sm", className);
  const iconEl = icon && G[icon as GlyphName] ? G[icon as GlyphName]() : null;
  if (locked) {
    return (
      <span className="cb-locked">
        <button {...rest} type="button" disabled className={cx("cb-btn", "cb-btn-" + v, size === "sm" && "cb-btn-sm")}>
          {G.lock()}
          {children}
        </button>
        <span className="cb-locked-why">{locked}</span>
      </span>
    );
  }
  return (
    <button type="button" {...rest} className={cls}>
      {iconEl}
      {children}
    </button>
  );
}
