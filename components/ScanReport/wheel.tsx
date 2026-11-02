/**
 * Two rings of ticks, turning against each other, in the rail while the
 * capture is still out.
 *
 * A wheel within a wheel, which is what the ophanim are. It is decoration and
 * says so: the progress bar above the frame is the reading, with a dot per
 * target, and this only marks the tile the capture will land in so the rail is
 * not a blank tint for thirty seconds.
 *
 * Each ring is its own `<svg>` so it turns as an element around its own centre,
 * which needs no `transform-box` on an inner group. Reduced motion stops both
 * and leaves the rings standing.
 */

/** The ticks of one ring as a single path, every `major`th one long. Rounded
 *  to two places because the server and the browser are different JavaScript
 *  engines, and a last-digit disagreement in `Math.cos` is a hydration error. */
function ticks(r: number, n: number, major: number): string {
  const at = (v: number) => (100 + v).toFixed(2);
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = i % major === 0 ? 7 : 3;
    d += `M${at(Math.cos(a) * r)} ${at(Math.sin(a) * r)}L${at(Math.cos(a) * (r - len))} ${at(Math.sin(a) * (r - len))}`;
  }
  return d;
}

const OUTER = ticks(78, 36, 3);
const INNER = ticks(52, 18, 3);

function Ring({
  r,
  d,
  className,
}: Readonly<{ r: number; d: string; className: string }>) {
  return (
    <svg viewBox="0 0 200 200" className={`absolute inset-0 size-full ${className}`}>
      <circle cx="100" cy="100" r={r} fill="none" stroke="currentColor" />
      <path d={d} stroke="currentColor" />
    </svg>
  );
}

export function ScanWheel() {
  return (
    <div className="flex w-full flex-1 items-center justify-center">
      <div className="relative size-[170px] text-foreground" aria-hidden>
        <Ring
          r={78}
          d={OUTER}
          className="opacity-45 motion-safe:animate-[spin_14s_linear_infinite]"
        />
        <Ring
          r={52}
          d={INNER}
          className="opacity-60 motion-safe:animate-[spin_9s_linear_infinite_reverse]"
        />
        <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
      </div>
    </div>
  );
}
