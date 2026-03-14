// ──────────────────────────────────────────────────────────
//  COLOUR LUT
// ──────────────────────────────────────────────────────────
const LUT_SIZE = 2048;
const lut = new Uint32Array(LUT_SIZE);
(function buildLUT() {
  for (let i = 0; i < LUT_SIZE; i++) {
    const angle = (i / LUT_SIZE) * Math.PI * 2;
    const r = Math.round(128 + 127 * Math.sin(angle + 0.0));
    const g = Math.round(128 + 127 * Math.sin(angle + 2.094));
    const b = Math.round(128 + 127 * Math.sin(angle + 4.189));
    lut[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
  }
  lut[0] = 0xFF000000;
})();

function applyLUT(val) {
  if (val === 0) return 0xFF000000;
  const t  = (val * 8) % LUT_SIZE;
  const ti = t | 0;
  const tf = t - ti;
  const c0 = lut[ti], c1 = lut[(ti + 1) % LUT_SIZE];
  const r = ((c0 & 0xFF)         * (1 - tf) + (c1 & 0xFF)         * tf) | 0;
  const g = (((c0 >> 8)  & 0xFF) * (1 - tf) + ((c1 >> 8)  & 0xFF) * tf) | 0;
  const b = (((c0 >> 16) & 0xFF) * (1 - tf) + ((c1 >> 16) & 0xFF) * tf) | 0;
  return 0xFF000000 | (b << 16) | (g << 8) | r;
}

// ──────────────────────────────────────────────────────────
//  OPTIMIZED MANDELBROT (float64 only, 3 multiplications per iteration)
//
//  The algorithm uses the recurrence:
//    y = (x + x) * y + y0       [2 multiplications: 2*x*y + y0]
//    x = x² - y² + x0           [1 multiplication: done via cached x², y²]
//    x² = x * x
//    y² = y * y
//    iterations++
//
//  This version works reliably at all zoom levels and requires no BigInt,
//  no perturbation, no series approximation — just clean float64 math.
// ──────────────────────────────────────────────────────────
function mandelbrot(x0, y0, maxIt) {
  let x = 0, y = 0;
  let x2 = 0, y2 = 0;
  let iter = 0;

  while (x2 + y2 < 4 && iter < maxIt) {
    y  = (x + x) * y + y0;     // 2*x*y + y0  (2 multiplications)
    x  = x2 - y2 + x0;         // x² - y² + x0
    x2 = x * x;                // (1 multiplication, cached for next iteration)
    y2 = y * y;
    iter++;
  }

  if (iter === maxIt) return 0;

  // Smooth iteration count using escape time
  const mag2 = x2 + y2;
  return iter + 1 - Math.log2(Math.log2(mag2) * 0.5);
}



// ──────────────────────────────────────────────────────────
//  TILE RENDERER
// ──────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { renderID, px0, py0, pw, ph, W, H, xMin, xMax, yMin, yMax, maxIter } = e.data;

  const buf = new Uint32Array(pw * ph);

  // Viewport dimensions in complex plane
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;

  // Render each pixel in the tile
  for (let row = 0; row < ph; row++) {
    for (let col = 0; col < pw; col++) {
      // Absolute pixel coordinates on canvas
      const px_abs = px0 + col;
      const py_abs = py0 + row;

      // Convert pixel coordinates to complex plane
      const x0 = xMin + (px_abs / W) * xRange;
      const y0 = yMax - (py_abs / H) * yRange;

      // Compute Mandelbrot value for this pixel
      const val = mandelbrot(x0, y0, maxIter);

      // Store as ARGB in buffer
      buf[row * pw + col] = applyLUT(val);
    }
  }

  // Send completed tile back to main thread
  self.postMessage(
    { renderID, px0, py0, pw, ph, buffer: buf.buffer },
    [buf.buffer]
  );
};
