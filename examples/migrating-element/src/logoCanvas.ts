export const CANVAS_W = 800;
export const CANVAS_H = 450;
export const REVEAL_MS = 15000;

const LOGO_CX = CANVAS_W / 2;
const LOGO_CY = CANVAS_H / 2;
const LOGO_SIZE = Math.min(CANVAS_W, CANVAS_H) * 0.78;
const LOGO_STROKE = LOGO_SIZE / 18;

const BG = "#f4f7fb";
const LIGHT_BAND = "#76b3e1";
const DARK_BAND = "#2c4f7c";
const MID_BAND = "#4f88c6";
const SPLAT_PALETTE = [
  "#0d3b66",
  "#1b6ca8",
  "#3aa8ff",
  "#76b3e1",
  "#fcbf49",
  "#f77f00",
  "#d62828",
  "#7b2cbf"
];

const CURVE_SAMPLES = 36;
const LINE_SAMPLES_PER_UNIT = 8;

type Point = [number, number];

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function bezier(P0: Point, P1: Point, P2: Point, P3: Point, t: number): Point {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    u3 * P0[0] + 3 * u2 * t * P1[0] + 3 * u * t2 * P2[0] + t3 * P3[0],
    u3 * P0[1] + 3 * u2 * t * P1[1] + 3 * u * t2 * P2[1] + t3 * P3[1]
  ];
}

const LOGO_PATHS = [
  {
    color: LIGHT_BAND,
    d: "M2 17.5c4.667 3 8 4.5 10 4.5 2.5 0 4 -1.5 4 -3.5S14.5 15 12 15c-2 0 -5.333 0.833 -10 2.5z"
  },
  {
    color: MID_BAND,
    d: "M5 13.5c4.667 -1.667 8 -2.5 10 -2.5 2.5 0 4 1.5 4 3.5 0 0.738 -0.204 1.408 -0.588 1.96l-2.883 3.825"
  },
  {
    color: DARK_BAND,
    d: "M22 6.5C18 3.5 14 2 12 2c-2.04 0 -2.618 0.463 -3.419 1.545"
  },
  { color: LIGHT_BAND, d: "m2 17.5 3 -4" },
  { color: DARK_BAND, d: "m22 6.5 -3 4" },
  { color: DARK_BAND, d: "M8.581 3.545 5.628 7.256" },
  {
    color: MID_BAND,
    d: "M7.416 12.662C5.906 12.186 5 11.183 5 9.5 5 7 6.5 6 9 6c1.688 0 5.087 1.068 8.198 3.204A114.76 114.76 0 0 1 19 10.5l-2.302 0.785"
  }
];

function toCanvasPoint([x, y]: Point): Point {
  return [
    LOGO_CX - LOGO_SIZE / 2 + (x / 24) * LOGO_SIZE,
    LOGO_CY - LOGO_SIZE / 2 + (y / 24) * LOGO_SIZE
  ];
}

function tokenizePath(d: string): string[] {
  return d.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
}

function isCommand(token: string | undefined): boolean {
  return !!token && /^[a-zA-Z]$/.test(token);
}

function sampleSvgPath(d: string): Point[] {
  const tokens = tokenizePath(d);
  const points: Point[] = [];
  let i = 0;
  let cmd = "";
  let pen: Point = [0, 0];
  let start: Point = [0, 0];
  let lastControl: Point | undefined;

  const nextNumber = () => Number(tokens[i++]);
  const addLine = (to: Point) => {
    const dist = Math.hypot(to[0] - pen[0], to[1] - pen[1]);
    const steps = Math.max(2, Math.ceil(dist * LINE_SAMPLES_PER_UNIT));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      points.push(toCanvasPoint([pen[0] + (to[0] - pen[0]) * t, pen[1] + (to[1] - pen[1]) * t]));
    }
    pen = to;
  };
  const addCurve = (c1: Point, c2: Point, to: Point) => {
    const from = pen;
    for (let step = 1; step <= CURVE_SAMPLES; step++) {
      points.push(toCanvasPoint(bezier(from, c1, c2, to, step / CURVE_SAMPLES)));
    }
    pen = to;
    lastControl = c2;
  };
  const addArc = (
    rx: number,
    ry: number,
    rotation: number,
    largeArc: number,
    sweep: number,
    to: Point
  ) => {
    const from = pen;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = (from[0] - to[0]) / 2;
    const dy = (from[1] - to[1]) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;

    let rxs = rx * rx;
    let rys = ry * ry;
    const correction = x1p ** 2 / rxs + y1p ** 2 / rys;
    if (correction > 1) {
      const scale = Math.sqrt(correction);
      rx *= scale;
      ry *= scale;
      rxs = rx * rx;
      rys = ry * ry;
    }

    const sign = largeArc === sweep ? -1 : 1;
    const coef =
      sign *
      Math.sqrt(
        Math.max(
          0,
          (rxs * rys - rxs * y1p ** 2 - rys * x1p ** 2) / (rxs * y1p ** 2 + rys * x1p ** 2)
        )
      );
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
    const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;

    const angle = (ux: number, uy: number, vx: number, vy: number) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      const sign = ux * vy - uy * vx < 0 ? -1 : 1;
      return sign * Math.acos(Math.min(1, Math.max(-1, dot / len)));
    };
    const ux = (x1p - cxp) / rx;
    const uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx;
    const vy = (-y1p - cyp) / ry;
    const startAngle = angle(1, 0, ux, uy);
    let deltaAngle = angle(ux, uy, vx, vy);
    if (!sweep && deltaAngle > 0) deltaAngle -= Math.PI * 2;
    if (sweep && deltaAngle < 0) deltaAngle += Math.PI * 2;

    const steps = Math.max(
      8,
      Math.ceil((Math.abs(deltaAngle) * Math.max(rx, ry) * LINE_SAMPLES_PER_UNIT) / 3)
    );
    for (let step = 1; step <= steps; step++) {
      const theta = startAngle + deltaAngle * (step / steps);
      points.push(
        toCanvasPoint([
          cx + cos * rx * Math.cos(theta) - sin * ry * Math.sin(theta),
          cy + sin * rx * Math.cos(theta) + cos * ry * Math.sin(theta)
        ])
      );
    }
    pen = to;
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) cmd = tokens[i++];

    switch (cmd) {
      case "M":
      case "m": {
        const relative = cmd === "m";
        pen = [nextNumber() + (relative ? pen[0] : 0), nextNumber() + (relative ? pen[1] : 0)];
        start = pen;
        lastControl = undefined;
        points.push(toCanvasPoint(pen));
        cmd = relative ? "l" : "L";
        break;
      }
      case "L":
      case "l": {
        const relative = cmd === "l";
        addLine([nextNumber() + (relative ? pen[0] : 0), nextNumber() + (relative ? pen[1] : 0)]);
        lastControl = undefined;
        break;
      }
      case "C":
      case "c": {
        const relative = cmd === "c";
        const ox = relative ? pen[0] : 0;
        const oy = relative ? pen[1] : 0;
        addCurve(
          [nextNumber() + ox, nextNumber() + oy],
          [nextNumber() + ox, nextNumber() + oy],
          [nextNumber() + ox, nextNumber() + oy]
        );
        break;
      }
      case "S":
      case "s": {
        const relative = cmd === "s";
        const ox = relative ? pen[0] : 0;
        const oy = relative ? pen[1] : 0;
        const c1 = lastControl
          ? ([2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]] as Point)
          : pen;
        addCurve(
          c1,
          [nextNumber() + ox, nextNumber() + oy],
          [nextNumber() + ox, nextNumber() + oy]
        );
        break;
      }
      case "A":
      case "a": {
        const relative = cmd === "a";
        const rx = nextNumber();
        const ry = nextNumber();
        const rotation = (nextNumber() * Math.PI) / 180;
        const largeArc = nextNumber();
        const sweep = nextNumber();
        const to: Point = [
          nextNumber() + (relative ? pen[0] : 0),
          nextNumber() + (relative ? pen[1] : 0)
        ];
        addArc(rx, ry, rotation, largeArc, sweep, to);
        lastControl = undefined;
        break;
      }
      case "Z":
      case "z":
        addLine(start);
        lastControl = undefined;
        cmd = "";
        break;
      default:
        throw new Error(`Unsupported logo path command: ${cmd}`);
    }
  }

  return points;
}

const LOGO_STROKES = LOGO_PATHS.map(path => ({
  color: path.color,
  pts: sampleSvgPath(path.d)
}));

const LOGO_SAMPLES = LOGO_STROKES.reduce((sum, stroke) => sum + stroke.pts.length, 0);

function strokeRange(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  fromIdx: number,
  toIdx: number,
  color: string
): void {
  if (toIdx <= fromIdx) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = LOGO_STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[fromIdx][0], pts[fromIdx][1]);
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
  ctx.restore();
}

function strokeLogoRange(ctx: CanvasRenderingContext2D, fromIdx: number, toIdx: number): void {
  let offset = 0;
  for (const stroke of LOGO_STROKES) {
    const end = offset + stroke.pts.length - 1;
    if (toIdx > offset && fromIdx <= end) {
      strokeRange(
        ctx,
        stroke.pts,
        Math.max(0, fromIdx - offset),
        Math.min(stroke.pts.length - 1, toIdx - offset),
        stroke.color
      );
    }
    offset += stroke.pts.length;
  }
}

export function createLogoCanvasPainter(ctx: CanvasRenderingContext2D) {
  let logoIdx = 0;

  return {
    reset() {
      logoIdx = 0;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    },
    drawUntil(progress: number) {
      const targetLogoIdx = Math.floor(clamp01(progress) * (LOGO_SAMPLES - 1));
      if (targetLogoIdx > logoIdx) {
        strokeLogoRange(ctx, logoIdx, targetLogoIdx);
        logoIdx = targetLogoIdx;
      }
    },
    splat(x: number, y: number, count: number) {
      const color = SPLAT_PALETTE[count % SPLAT_PALETTE.length];
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 32);
      grad.addColorStop(0, color);
      grad.addColorStop(0.6, color + "aa");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, 32, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}
