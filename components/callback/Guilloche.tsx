import * as React from "react";
import { cx } from "./cx";

export interface GuillocheProps {
  size?: number;
  lobes?: number;
  strands?: number;
  amp?: number;
  className?: string;
  style?: React.CSSProperties;
}

/* Guilloche — security-print rosette: interleaved sine rings, like the seal on a banknote. */
function rosettePaths(size: number, opt: Partial<GuillocheProps>): string[] {
  const c = size / 2;
  const k = opt.lobes || 18;
  const n = opt.strands || 16;
  const out: string[] = [];
  const rings: Array<[number, number, number, number]> = [
    [0.36, opt.amp ? opt.amp / size : 0.07, k, n],
    [0.21, 0.05, Math.max(5, Math.round(k * 0.6)), Math.max(5, Math.round(n * 0.6))],
  ];
  rings.forEach((g) => {
    const R = g[0] * size;
    const A = g[1] * size;
    for (let s = 0; s < g[3]; s++) {
      const ph = (s * Math.PI * 2) / g[3];
      let d = "";
      for (let i = 0; i <= 360; i++) {
        const t = (i / 360) * Math.PI * 2;
        const r = R + A * Math.sin(g[2] * t + ph);
        d += (i ? "L" : "M") + (c + r * Math.cos(t)).toFixed(2) + " " + (c + r * Math.sin(t)).toFixed(2);
      }
      out.push(d + "Z");
    }
  });
  return out;
}

export function Guilloche(p: GuillocheProps): React.ReactElement {
  const size = p.size || 64;
  return (
    <svg
      className={cx("cb-guilloche", p.className)}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      style={p.style}
    >
      {rosettePaths(size, p).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
