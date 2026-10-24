// Glyphs from design/callback/components/bundle.js: 16 grid, 1.5 stroke, currentColor.
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const glyphs = {
  tick: () => <Svg><path d="M3.5 8.5l3 3 6-7" /></Svg>,
  x: () => <Svg><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" strokeWidth={1.8} /></Svg>,
  q: () => (
    <Svg>
      <path d="M6 6a2 2 0 113 1.7c-.7.4-1 .8-1 1.5" />
      <circle cx={8} cy={11.6} r={0.6} fill="currentColor" />
    </Svg>
  ),
  clock: () => (
    <Svg>
      <circle cx={8} cy={8} r={5.8} />
      <path d="M8 4.8V8l2.2 1.4" />
    </Svg>
  ),
  person: () => (
    <Svg>
      <circle cx={8} cy={5.5} r={2.5} />
      <path d="M3.5 13.5c.6-2.5 2.4-3.7 4.5-3.7s3.9 1.2 4.5 3.7" />
    </Svg>
  ),
  hold: () => <Svg><path d="M6 4v8M10 4v8" strokeWidth={2} /></Svg>,
  lock: () => (
    <Svg>
      <rect x={3.5} y={7} width={9} height={6.5} rx={1} />
      <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" />
    </Svg>
  ),
  phone: () => (
    <Svg>
      <path d="M5.2 2.5H3.4a1 1 0 00-1 1.1 10.5 10.5 0 009.8 9.8 1 1 0 001.1-1v-1.8a1 1 0 00-.8-1l-2-.5a1 1 0 00-1 .3l-.7.8a7.5 7.5 0 01-3.3-3.3l.8-.7a1 1 0 00.3-1l-.5-2a1 1 0 00-1-.7z" />
    </Svg>
  ),
};
