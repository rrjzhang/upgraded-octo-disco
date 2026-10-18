/**
 * Projective map from the unit square to a quad, for drawing a flat image onto a TV seen at an angle.
 * Corners in order: top-left, top-right, bottom-right, bottom-left (u,v) = (0,0), (1,0), (1,1), (0,1).
 * Returns [a, b, c, d, e, f, g, h] with  x = (a u + b v + c) / (g u + h v + 1),  y = (d u + e v + f) / (g u + h v + 1).
 * (Heckbert, "Fundamentals of Texture Mapping and Image Warping", 1989, square-to-quad.)
 */
export type Quad = [number, number][];
export type H8 = [number, number, number, number, number, number, number, number];

export function homography(q: Quad): H8 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // a parallelogram: affine
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

/** Applies the map to (u, v); for tests and dev checks. */
export function project(m: H8, u: number, v: number): [number, number] {
  const [a, b, c, d, e, f, g, h] = m;
  const w = g * u + h * v + 1;
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
}

/**
 * CSS `matrix3d(...)` that maps an element of size w x h (transform-origin 0 0) onto the quad given in the
 * parent's pixels. The element's (X, Y) is first scaled to the unit square (X / w, Y / h). CSS lists the 4x4
 * matrix column by column.
 */
export function matrix3d(q: Quad, w: number, h: number): string {
  const [a, b, c, d, e, f, g, hh] = homography(q);
  const m = [
    a / w, d / w, 0, g / w,
    b / h, e / h, 0, hh / h,
    0, 0, 1, 0,
    c, f, 0, 1,
  ];
  return `matrix3d(${m.map((x) => +x.toFixed(10)).join(',')})`;
}
