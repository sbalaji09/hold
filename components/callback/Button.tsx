import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { glyphs } from "./glyphs";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "hold" | "ask";
  size?: "md" | "sm";
  icon?: "phone" | "hold" | "tick" | "lock" | "clock" | "person";
  /** Why this can't be pressed, and who can. */
  locked?: string;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

function cx(...names: (string | false | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

/** Port of design/callback Button: primary | secondary | hold | ask. `locked` = why it can't be pressed. */
export function Button({ variant = "secondary", size, icon, locked, className, children, ...rest }: ButtonProps) {
  const btn = cx("cb-btn", `cb-btn-${variant}`, size === "sm" && "cb-btn-sm");
  if (locked) {
    return (
      <span className="cb-locked">
        <button {...rest} type="button" disabled className={btn}>
          {glyphs.lock()}
          {children}
        </button>
        <span className="cb-locked-why">{locked}</span>
      </span>
    );
  }
  return (
    <button type="button" {...rest} className={variant === "ask" ? cx("cb-ask", className) : cx(btn, className)}>
      {icon ? glyphs[icon]() : null}
      {children}
    </button>
  );
}
