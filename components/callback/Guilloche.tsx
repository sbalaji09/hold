import type { CSSProperties } from "react";

export interface GuillocheProps {
  size?: number;
  lobes?: number;
  strands?: number;
  amp?: number;
  className?: string;
  style?: CSSProperties;
}

/** Security-print rosette, maths copied exactly from design/callback/components/bundle.js. */
function rosettePaths(size: number, opt: GuillocheProps): string[] {
  const c = size / 2;
  const k = opt.lobes || 18;
  const n = opt.strands || 16;
  const out: string[] = [];
  const rings: [number, number, number, number][] = [
    [0.36, opt.amp ? opt.amp / size : 0.07, k, n],
    [0.21, 0.05, Math.max(5, Math.round(k * 0.6)), Math.max(5, Math.round(n * 0.6))],
  ];
  for (const g of rings) {
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
  }
  return out;
}

export function Guilloche(props: GuillocheProps) {
  const size = props.size || 64;
  return (
    <svg
      className={["cb-guilloche", props.className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      style={props.style}
    >
      {rosettePaths(size, props).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
