"use client";
import * as React from "react";
import Link from "next/link";
import { AccountLine, Amount, Cite } from "@/components/callback";
import { formatPhone } from "@/components/voice/format";
import { shortDate } from "@/lib/inbox";
import { CATEGORY_LABEL, RING, type GraphNode, type SupplierFacts, type SupplierGraph as Graph } from "@/lib/supplierGraph";

const STATUS_LABEL = { new: "New", trusted: "Trusted", under_review: "Under review" } as const;
const SPAN = RING.supplier + 190; // room for the longest supplier name outside the ring
const FULL = { x: -SPAN, y: -SPAN, w: SPAN * 2 }; // the viewBox is always square
const MIN_W = FULL.w / 8; // up to 8x

type View = typeof FULL;

/** Zoom by `factor` around the point (px, py), keeping that point under the cursor. */
function zoomAt(v: View, factor: number, px: number, py: number): View {
  const w = Math.min(FULL.w, Math.max(MIN_W, v.w * factor));
  return clampView({ x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * w) / v.w, w });
}

/** Keep the middle of the view inside the graph, so it can't be panned away entirely. */
function clampView(v: View): View {
  const clamp = (c: number) => Math.min(SPAN, Math.max(-SPAN, c + v.w / 2)) - v.w / 2;
  return { x: clamp(v.x), y: clamp(v.y), w: v.w };
}

/** Serial red where money stopped or someone pretended to be a supplier, graphite while new. */
function supplierTone(f: SupplierFacts): string {
  if (f.held > 0 || f.lookalikes.length > 0 || f.sharesAccountWith.length > 0) return "var(--hold)";
  if (f.supplier.status === "new") return "var(--graphite)";
  return "var(--ink)";
}

export function SupplierGraph({ graph }: { graph: Graph }): React.ReactElement {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>(FULL);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const dragged = React.useRef(false); // swallow the click that ends a pan
  const byId = React.useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  // Only a click dims the rest; dimming on hover flickered as the pointer crossed label glyphs.
  const focus = selected;
  const linked = React.useMemo(() => {
    if (!focus) return null;
    const ids = new Set([focus]);
    for (const e of graph.edges) if (e.from === focus || e.to === focus) ids.add(e.from).add(e.to);
    return ids;
  }, [focus, graph]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wheel (and trackpad pinch) zooms toward the cursor. A native listener, because React's onWheel
  // is passive and can't stop the page scrolling underneath.
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      setView((v) => zoomAt(v, Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), p.x, p.y));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return; // still a click
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const unitsPerPx = d.view.w / Math.min(rect.width, rect.height);
    setView(clampView({ x: d.view.x - dx * unitsPerPx, y: d.view.y - dy * unitsPerPx, w: d.view.w }));
  };
  const onPointerUp = () => {
    dragged.current = drag.current?.moved ?? false;
    drag.current = null;
  };
  const zoomBy = (factor: number) => setView((v) => zoomAt(v, factor, v.x + v.w / 2, v.y + v.w / 2));

  const open = selected ? byId.get(selected) : undefined;
  const select = (id: string) => setSelected((s) => (s === id ? null : id));
  const nodeProps = (n: GraphNode, label: string) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    "aria-pressed": selected === n.id,
    className: "pt-graph-node",
    onClick: (e: React.MouseEvent) => (e.stopPropagation(), select(n.id)),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(n.id)),
    opacity: linked && !linked.has(n.id) ? 0.25 : 1,
  });

  return (
    <div
      className="cb-doc pt-graph"
      onClickCapture={(e) => {
        if (dragged.current) {
          dragged.current = false;
          e.stopPropagation();
        }
      }}
      onClick={() => setSelected(null)}
    >
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.w}`}
        role="group"
        aria-label="Suppliers by category"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {graph.edges.map((e) => {
          const a = byId.get(e.from)!;
          const b = byId.get(e.to)!;
          const red = e.kind === "lookalike" || e.kind === "shared_account";
          const lit = linked ? linked.has(e.from) && linked.has(e.to) && (e.from === focus || e.to === focus) : true;
          // Shared-account links bow towards the centre so they don't run along the ring.
          const d = e.kind === "shared_account" ? `M${a.x},${a.y} Q${(a.x + b.x) / 5},${(a.y + b.y) / 5} ${b.x},${b.y}` : `M${a.x},${a.y} L${b.x},${b.y}`;
          return (
            <path
              key={`${e.from}>${e.to}`}
              d={d}
              fill="none"
              stroke={red ? "var(--hold)" : lit && linked ? "var(--ink-muted)" : "var(--line)"}
              strokeWidth={red || (lit && linked) ? 1.5 : 1}
              strokeDasharray={e.kind === "shared_account" ? "4 3" : undefined}
              opacity={lit ? 1 : 0.2}
            >
              {e.label && <title>{e.label}</title>}
            </path>
          );
        })}

        {graph.nodes.map((n) => {
          if (n.kind === "fogline") {
            return (
              <g key={n.id} transform="translate(0,0)">
                <circle r={30} fill="var(--action)" />
                <text textAnchor="middle" dy="0.35em" fill="var(--on-action)" fontFamily="var(--font-serif)" fontSize={15} fontWeight={500}>
                  Fogline
                </text>
              </g>
            );
          }
          if (n.kind === "category") {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} {...nodeProps(n, `${CATEGORY_LABEL[n.category]}, ${n.count} suppliers`)}>
                <circle r={9} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
                <text className="cb-caps" textAnchor="middle" y={24} fill="currentColor">
                  {CATEGORY_LABEL[n.category]} · {n.count}
                </text>
              </g>
            );
          }
          if (n.kind === "lookalike") {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} {...nodeProps(n, `${n.domain}, a look-alike domain`)}>
                <rect x={-6} y={-6} width={12} height={12} fill="var(--hold-tint)" stroke="var(--hold)" strokeWidth={1.5} />
                <text textAnchor="middle" y={20} fill="var(--hold)" fontFamily="var(--font-mono)" fontSize={11}>
                  {n.domain}
                </text>
              </g>
            );
          }
          const f = n.facts;
          const left = Math.cos(n.angle) < 0;
          const deg = (n.angle * 180) / Math.PI + (left ? 180 : 0);
          const tone = supplierTone(f);
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} {...nodeProps(n, `${f.supplier.name}, ${CATEGORY_LABEL[f.supplier.category]}`)}>
              <circle r={selected === n.id ? 9 : 7} fill={selected === n.id ? tone : "var(--surface)"} stroke={tone} strokeWidth={1.5} />
              <text
                transform={`rotate(${deg})`}
                x={left ? -14 : 14}
                dy="0.35em"
                textAnchor={left ? "end" : "start"}
                fill="var(--ink)"
                fontFamily="var(--font-sans)"
                fontSize={13}
                fontWeight={selected === n.id ? 600 : 400}
              >
                {f.supplier.name}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="pt-graph-zoom" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="cb-btn cb-btn-secondary cb-btn-sm" onClick={() => zoomBy(1 / 1.5)} disabled={view.w <= MIN_W} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="cb-btn cb-btn-secondary cb-btn-sm" onClick={() => zoomBy(1.5)} disabled={view.w >= FULL.w} aria-label="Zoom out">
          −
        </button>
        <button type="button" className="cb-btn cb-btn-secondary cb-btn-sm" onClick={() => setView(FULL)} disabled={view === FULL}>
          Reset
        </button>
        <span className="font-mono text-[11.5px] text-ink-muted">{Math.round((FULL.w / view.w) * 100)}%</span>
      </div>

      <p className="pt-graph-key font-mono text-[11.5px] text-ink-muted">
        Lines run Fogline → category → supplier. Red links: a look-alike sender domain, or one bank account asked for by two suppliers.
        Scroll to zoom, drag to move.
      </p>

      {open && (open.kind === "supplier" || open.kind === "lookalike" || open.kind === "category") && (
        <div className="pt-graph-pop" role="dialog" aria-label="Details" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="pt-back self-end" onClick={() => setSelected(null)}>
            Close
          </button>
          {open.kind === "supplier" && <SupplierCard f={open.facts} names={byId} />}
          {open.kind === "lookalike" && <LookalikeCard domain={open.domain} supplier={byId.get(open.supplierKey)} />}
          {open.kind === "category" && (
            <>
              <div className="cb-caps">Category</div>
              <h2 className="cb-subject text-ink">{CATEGORY_LABEL[open.category]}</h2>
              <p className="font-mono text-[12.5px] text-ink">
                {open.count} supplier{open.count === 1 ? "" : "s"} on file. Pick one on the ring to see it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SupplierCard({ f, names }: { f: SupplierFacts; names: Map<string, GraphNode> }): React.ReactElement {
  const s = f.supplier;
  const nameOf = (key: string) => {
    const n = names.get(key);
    return n?.kind === "supplier" ? n.facts.supplier.name : key;
  };
  return (
    <>
      <div className="cb-caps">
        {CATEGORY_LABEL[s.category]} · {STATUS_LABEL[s.status ?? "trusted"]}
      </div>
      <h2 className="cb-subject text-ink">{s.name}</h2>
      <p className="font-mono text-[12px] text-ink-muted">{s.domain}</p>

      <dl className="pt-graph-facts">
        <dt className="cb-caps">Contact</dt>
        <dd className="font-serif italic text-signatory">{s.contactName || "None on file"}</dd>
        <dt className="cb-caps">Trusted phone</dt>
        <dd className="font-mono text-[12.5px] text-ink">
          {s.trustedPhone ? formatPhone(s.trustedPhone) : "No number on file"}
          <span className="block text-ink-muted">Last checked {s.phoneLastCheckedAt ? shortDate(s.phoneLastCheckedAt) : "never"}</span>
        </dd>
        <dt className="cb-caps">Paid so far</dt>
        <dd className="font-mono text-[12.5px] text-ink">
          <Amount cents={f.paidCents} />
          <span className="block text-ink-muted">
            {f.bills} bill{f.bills === 1 ? "" : "s"}
            {f.lastBillAt ? `, last on ${shortDate(f.lastBillAt)}` : ""}
          </span>
        </dd>
        <dt className="cb-caps">Open</dt>
        <dd className="font-mono text-[12.5px] text-ink">
          {f.openItems} open{f.held > 0 ? `, ${f.held} held` : ""}
        </dd>
      </dl>

      {f.accounts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="cb-caps">Accounts on its bills</div>
          {f.accounts.slice(0, 3).map((a) => (
            <AccountLine key={a.key} bank={a.bank} last4={a.last4} state={a.status === "active" ? "verified" : "new"} note={a.status === "active" ? "Active" : "Retired"} />
          ))}
        </div>
      )}

      {f.lookalikes.map((d) => (
        <p key={d} className="font-mono text-[12.5px] text-hold">
          {d} sent a bill pretending to be {s.domain}.
        </p>
      ))}
      {f.sharesAccountWith.map((x) => (
        <p key={x.supplierKey + x.account} className="font-mono text-[12.5px] text-hold">
          {nameOf(x.supplierKey)} asked to be paid into the same {x.account}.
        </p>
      ))}

      <Cite href={`/suppliers/${s.key}`}>Supplier record</Cite>
      <Link href={`/suppliers/${s.key}`} className="cb-btn cb-btn-primary cb-btn-sm no-underline">
        Open supplier page
      </Link>
    </>
  );
}

function LookalikeCard({ domain, supplier }: { domain: string; supplier?: GraphNode }): React.ReactElement {
  const s = supplier?.kind === "supplier" ? supplier.facts.supplier : null;
  return (
    <>
      <div className="cb-caps">Look-alike domain</div>
      <h2 className="cb-subject text-hold">{domain}</h2>
      <p className="font-mono text-[12.5px] text-ink">
        Sent Fogline a bill as {s?.name ?? "a supplier"}. Their domain on file is {s?.domain ?? "different"}.
      </p>
      {s && <Cite href={`/suppliers/${s.key}`}>{s.name}</Cite>}
    </>
  );
}
