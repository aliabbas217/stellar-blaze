import type { ReactNode } from "react";

/*
 * The two thin-line isometric figures of the landing (inline SVG, 1 px strokes, mono labels, one accent edge each; ported from the approved
 * prototype). Static pictures of the product, never readings: the crews and times are made up and the slide's tag says so. Every word is a prop
 * (a catalogue string chosen by the slide), nothing is typed here. They are server components with no script.
 *
 *   plan figure: three crews (A, C, D) as stacked slabs with their level edge, and the Stop action as the one solid slab of the page, as in the app.
 *   boundary figure: Asked, Refused, Seen, left to right; HTML so the words wrap and read right to left, the small drawings are inline SVG.
 */

const C30 = 0.866;
const S30 = 0.5;
type P = readonly [number, number];
type Iso = (x: number, y: number, z: number) => P;
const f1 = (n: number): string => n.toFixed(1);
const iso =
  (ox: number, oy: number): Iso =>
  (x, y, z) => [ox + (x - y) * C30, oy + (x + y) * S30 - z];
const pts = (a: readonly P[]): string => a.map((p) => `${f1(p[0])},${f1(p[1])}`).join(" ");

/** A box with its top, left (y = B) and right (x = A) faces; `cls` are the CSS classes of the left, right and top faces. */
function Box({ P, A, B, T, z0, cls }: { readonly P: Iso; readonly A: number; readonly B: number; readonly T: number; readonly z0: number; readonly cls: readonly [string, string, string] }) {
  const top = [P(0, 0, z0 + T), P(A, 0, z0 + T), P(A, B, z0 + T), P(0, B, z0 + T)];
  const left = [P(0, B, z0), P(A, B, z0), P(A, B, z0 + T), P(0, B, z0 + T)];
  const right = [P(A, 0, z0), P(A, B, z0), P(A, B, z0 + T), P(A, 0, z0 + T)];
  return (
    <>
      <polygon className={cls[1]} points={pts(left)} />
      <polygon className={cls[2]} points={pts(right)} />
      <polygon className={cls[0]} points={pts(top)} />
    </>
  );
}

function Rule({ a, b, cls = "g" }: { readonly a: P; readonly b: P; readonly cls?: string }) {
  return <line className={cls} x1={f1(a[0])} y1={f1(a[1])} x2={f1(b[0])} y2={f1(b[1])} />;
}

export interface PlanFigureProps {
  readonly label: string;
  readonly crews: readonly { readonly letter: "A" | "C" | "D"; readonly name: string; readonly task: string }[];
  readonly level: string;
  readonly unsigned: string;
  readonly stop: string;
}

export function PlanFigure({ label, crews, level, unsigned, stop }: PlanFigureProps) {
  const A = 200;
  const B = 130;
  const T = 12;
  const GAP = 112;
  const P0 = iso(200, 300);
  const order: readonly ("D" | "C" | "A")[] = ["D", "C", "A"];
  const parts: ReactNode[] = [<Rule key="guide" a={P0(A, B, 0)} b={P0(A, B, 2 * GAP + T)} cls="gd" />];
  const words: ReactNode[] = [];
  order.forEach((letter, n) => {
    const crew = crews.find((c) => c.letter === letter);
    const z = n * GAP;
    const rc = P0(A, 0, z + T / 2);
    parts.push(<Box key={`b${letter}`} P={P0} A={A} B={B} T={T} z0={z} cls={["f", "f", "lvl"]} />);
    parts.push(<Rule key={`r${letter}`} a={[rc[0] + 8, rc[1]]} b={[372, rc[1]]} />);
    words.push(
      <g key={`w${letter}`}>
        <text x="384" y={f1(rc[1] - 4)} className="t24">{crew?.name}</text>
        <text x="384" y={f1(rc[1] + 20)} className="t14">{crew?.task}</text>
        <rect className="mk" x="384" y={f1(rc[1] + 34)} width="10" height="10" rx="2" />
        <text x="402" y={f1(rc[1] + 44)} className="t16b">{level}</text>
        <text x="384" y={f1(rc[1] + 68)} className="t12">{unsigned}</text>
      </g>,
    );
  });
  // the Stop action: a small solid slab on Crew A, with its cross glyph
  const zs = 2 * GAP + T;
  const [sx, sy, sw, sd, st] = [70, 40, 64, 50, 10];
  const [cx, cy, a, L] = [sw / 2, sd / 2, 4, 13];
  const top = zs + st + 0.3;
  const cross: readonly P[] = [[cx - a, cy - L], [cx + a, cy - L], [cx + a, cy - a], [cx + L, cy - a], [cx + L, cy + a], [cx + a, cy + a], [cx + a, cy + L], [cx - a, cy + L], [cx - a, cy + a], [cx - L, cy + a], [cx - L, cy - a], [cx - a, cy - a]];
  const PS: Iso = (x, y, z) => P0(x + sx, y + sy, z);
  const sr = PS(sw, 0, zs + st / 2);
  const ly = P0(A, 0, 2 * GAP + T / 2)[1] - 96;
  return (
    <svg className="fg" viewBox="75 52 475 425" role="img" aria-label={label}>
      {parts}
      <Box P={PS} A={sw} B={sd} T={st} z0={zs} cls={["ink", "ink2", "ink3"]} />
      <polygon className="gl" points={pts(cross.map(([x, y]) => PS(x, y, top)))} />
      <Rule a={[sr[0] + 6, sr[1]]} b={[350, sr[1]]} />
      <Rule a={[350, sr[1]]} b={[350, ly]} />
      <Rule a={[350, ly]} b={[372, ly]} />
      <text x="384" y={f1(ly + 5)} className="t16b">{stop}</text>
      {words}
    </svg>
  );
}

export interface BoundaryFigureProps {
  readonly label: string;
  readonly asked: { readonly tag: string; readonly lead: string; readonly line: string };
  readonly refused: { readonly tag: string; readonly lead: string; readonly line: string };
  readonly seen: { readonly tag: string; readonly lead: string; readonly line: string };
  readonly earlier: string;
  readonly entry: string;
}

function Page({ strike = false }: { readonly strike?: boolean }) {
  return (
    <svg viewBox="0 0 110 130" aria-hidden="true">
      <rect className="pg" x="15" y="5" width="80" height="120" rx="2" />
      <rect className="pg" x="25" y="15" width="22" height="22" rx="2" />
      {[52, 64, 76, 88, 100].map((y) => (
        <line key={y} className="ln" x1="25" y1={y} x2="85" y2={y} />
      ))}
      {strike ? (
        <>
          <line className="x" x1="19" y1="9" x2="91" y2="121" />
          <rect className="bd" x="66" y="92" width="30" height="30" rx="2" />
          <path className="bx" d="M75 101 L87 113 M87 101 L75 113" />
        </>
      ) : null}
    </svg>
  );
}

function Chain({ earlier, entry }: { readonly earlier: string; readonly entry: string }) {
  return (
    <svg viewBox="0 0 230 130" aria-hidden="true">
      {[4, 84, 164].map((x, i) => (
        <rect key={x} className={i === 2 ? "en new" : "en"} x={x} y="45" width="62" height="40" rx="2" />
      ))}
      {[
        [66, 84],
        [146, 164],
      ].map(([a, z]) => (
        <g key={a}>
          <line className="lk" x1={a} y1="65" x2={z} y2="65" />
          <rect className="nd" x={(a ?? 0) - 3} y="62" width="6" height="6" rx="1" />
          <rect className="nd" x={(z ?? 0) - 3} y="62" width="6" height="6" rx="1" />
        </g>
      ))}
      <text className="mn" x="35" y="106" textAnchor="middle">{earlier}</text>
      <text className="mn" x="115" y="106" textAnchor="middle">{entry}</text>
      <text className="mn" x="195" y="106" textAnchor="middle">{entry}</text>
    </svg>
  );
}

const Arrow = () => (
  <span className="ar" aria-hidden="true">
    <svg viewBox="0 0 48 12">
      <line x1="0" y1="6" x2="44" y2="6" />
      <path d="M38 1 L45 6 L38 11" fill="none" />
    </svg>
  </span>
);

function Panel({ n, tag, lead, line, vis, no = false }: { readonly n: string; readonly tag: string; readonly lead: string; readonly line: string; readonly vis: ReactNode; readonly no?: boolean }) {
  return (
    <article className={no ? "pn no" : "pn"}>
      <p className="pl">
        <span>{n}</span>
        {tag}
      </p>
      <div className="vis">{vis}</div>
      <div className="tx">
        <p className="pt">{lead}</p>
        <p className="ps">{line}</p>
      </div>
    </article>
  );
}

export function BoundaryFigure({ label, asked, refused, seen, earlier, entry }: BoundaryFigureProps) {
  return (
    <div className="flow" role="group" aria-label={label}>
      <Panel n="1" {...asked} vis={<Page />} />
      <Arrow />
      <Panel n="2" {...refused} vis={<Page strike />} no />
      <Arrow />
      <Panel n="3" {...seen} vis={<Chain earlier={earlier} entry={entry} />} />
    </div>
  );
}
