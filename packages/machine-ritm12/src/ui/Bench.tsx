import { useEffect, useRef, type CSSProperties } from 'react';
import { useReadout } from './context';
import { ASHTRAY, PLATE, type Rect } from './layout';
import { useReducedMotion } from './motion';
import { SMOKE, STRANDS, strandAt, type SmokePoint } from './smoke';

/** Where a box of the picture is on its frame, as shares of the frame, since the bench is not on the scaled stage. */
function shareOf([left, top, right, bottom]: Rect): CSSProperties {
  const share = (value: number, of: number) => `${(value / of) * 100}%`;
  return {
    left: share(left, PLATE.width),
    top: share(top, PLATE.height),
    width: share(right - left, PLATE.width),
    height: share(bottom - top, PLATE.height),
  };
}

/** The smoke as it is in each light: its colour, and how thick it looks. */
const SMOKE_IN = {
  lit: { colour: '238 228 210', strength: 0.3 },
  out: { colour: '206 216 232', strength: 0.36 },
} as const;
/** The smoke is drawn in bands up each strand, each a little wider and fainter than the one under it. */
const BANDS = 11;
/** The picture ends partway across the smoke's box. The smoke thins out before that edge, where it would otherwise stop dead. */
const EDGE = { thins: 0.52, gone: 0.69 } as const;
/** How fast the smoke moves, against how fast its strands are written to: slow, as smoke is in still air. */
const PACE = 0.125;
const FRAME_MS = 1000 / 30;
/** The moment a still picture of the smoke shows, chosen for a good shape. */
const STILL_AT = 11.5;

function draw(context: CanvasRenderingContext2D, width: number, height: number, time: number, light: keyof typeof SMOKE_IN) {
  const { colour, strength } = SMOKE_IN[light];
  const place = (point: SmokePoint): [number, number] => [width / 2 + point.across * height, height * (1 - point.up / SMOKE.height)];
  context.clearRect(0, 0, width, height);
  context.lineCap = 'butt';
  context.lineJoin = 'round';
  for (const strand of STRANDS) {
    const points = strandAt(strand, time);
    const perBand = Math.ceil(SMOKE.samples / BANDS);
    for (let start = 0; start < SMOKE.samples; start += perBand) {
      const band = points.slice(start, start + perBand + 1);
      const middle = band[Math.floor(band.length / 2)]!;
      context.beginPath();
      band.forEach((point, index) => {
        const [x, y] = place(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.lineWidth = Math.max(1, middle.width * height);
      const kept = Math.min(1, Math.max(0, (EDGE.gone - place(middle)[0] / width) / (EDGE.gone - EDGE.thins)));
      context.strokeStyle = `rgb(${colour} / ${(middle.density * strength * kept).toFixed(3)})`;
      context.stroke();
    }
  }
}

/** The smoke off the cigarette, drawn while it can be seen and held still for whoever asked for less movement. */
function Smoke({ light }: { light: keyof typeof SMOKE_IN }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();

  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return undefined;
    let frame = 0;
    let seen = true;
    let drawnAt = -Infinity;

    const paint = (now: number) => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(node.clientWidth * scale);
      const height = Math.round(node.clientHeight * scale);
      if (node.width !== width || node.height !== height) Object.assign(node, { width, height });
      if (width > 0 && height > 0) draw(context, width, height, still ? STILL_AT : (now / 1000) * PACE, light);
    };
    const tick = (now: number) => {
      if (now - drawnAt >= FRAME_MS) {
        drawnAt = now;
        paint(now);
      }
      frame = requestAnimationFrame(tick);
    };
    const follow = () => {
      cancelAnimationFrame(frame);
      const moving = !still && seen && document.visibilityState === 'visible';
      if (moving) frame = requestAnimationFrame(tick);
      else paint(performance.now());
    };

    const watcher = new IntersectionObserver(([entry]) => {
      seen = entry?.isIntersecting ?? true;
      follow();
    });
    const sized = new ResizeObserver(follow);
    watcher.observe(node);
    sized.observe(node);
    document.addEventListener('visibilitychange', follow);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      sized.disconnect();
      document.removeEventListener('visibilitychange', follow);
    };
  }, [still, light]);

  return <canvas ref={canvas} className="rt-smoke" style={shareOf(ASHTRAY.smoke)} data-still={still || undefined} data-testid="smoke" />;
}

/**
 * What stands on the bench beside the machine: an ashtray, with a cigarette
 * burning in it. It is there to look at. Nothing of it can be pressed, and
 * presses go through it to the machine.
 */
export function Bench({ lampLit }: { lampLit: boolean }) {
  const { art } = useReadout();
  const lit = art('props/ashtray.png');
  const dark = art('night/props/ashtray.png');
  const ember = ASHTRAY.ember;
  return (
    <div className="rt-bench" aria-hidden="true" data-testid="bench">
      {lit ? <img className="rt-ashtray" style={shareOf(ASHTRAY.rect)} src={lit} alt="" draggable={false} data-testid="ashtray" /> : null}
      {dark ? <img className="rt-ashtray rt-ashtray-night" style={shareOf(ASHTRAY.rect)} src={dark} alt="" draggable={false} /> : null}
      <span className="rt-ember" style={shareOf([ember.x - ember.r, ember.y - ember.r, ember.x + ember.r, ember.y + ember.r])} />
      <Smoke light={lampLit ? 'lit' : 'out'} />
    </div>
  );
}
