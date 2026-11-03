import type { InkStroke } from "@bernou/audience-protocol";

/**
 * Removes what an eraser at (x, y) touches and splits strokes around the gap, so
 * it erases only that part. Also catches a stroke crossing the eraser between
 * two points, since a fast stroke's points can be far apart. Returns the same
 * array if nothing was touched.
 */
export function eraseAt(strokes: InkStroke[], x: number, y: number, radiusX: number, radiusY: number): InkStroke[] {
  // In units of the eraser's radius, where it's a circle of radius 1 at the origin.
  const px = (v: number) => (v - x) / radiusX;
  const py = (v: number) => (v - y) / radiusY;
  const pointHit = (a: number, b: number) => px(a) ** 2 + py(b) ** 2 <= 1;
  const segmentHit = (x1: number, y1: number, x2: number, y2: number) => {
    const ax = px(x1);
    const ay = py(y1);
    const dx = px(x2) - ax;
    const dy = py(y2) - ay;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
    return (ax + t * dx) ** 2 + (ay + t * dy) ** 2 <= 1;
  };

  let changed = false;
  const out: InkStroke[] = [];
  for (const stroke of strokes) {
    const { points } = stroke;
    let piece: number[] = [];
    const finish = () => {
      if (piece.length > 0) out.push({ ...stroke, points: piece });
      piece = [];
    };
    let touched = false;
    for (let i = 0; i < points.length; i += 2) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (pointHit(a, b)) {
        touched = true;
        finish();
        continue;
      }
      if (i > 0 && !pointHit(points[i - 2]!, points[i - 1]!) && segmentHit(points[i - 2]!, points[i - 1]!, a, b)) {
        touched = true;
        finish();
      }
      piece.push(a, b);
    }
    if (touched) {
      changed = true;
      finish();
    } else {
      out.push(stroke);
    }
  }
  return changed ? out : strokes;
}
