// ──────────────────────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────────────────────
const DEFAULT = {
  xMin: -2.0, xMax: 0.47,
  yMin: -1.12, yMax: 1.12,
};

let view     = { ...DEFAULT };
let maxIter  = 256;
let renderID = 0;

// ──────────────────────────────────────────────────────────
//  DOM REFS
// ──────────────────────────────────────────────────────────
const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');
const iCx     = document.getElementById('i-cx');
const iCy     = document.getElementById('i-cy');
const iZoom   = document.getElementById('i-zoom');
const iIter   = document.getElementById('i-iter');
const badge   = document.getElementById('precision-badge');
const spinner = document.getElementById('spinner');
const chH     = document.getElementById('ch-h');
const chV     = document.getElementById('ch-v');

// ──────────────────────────────────────────────────────────
//  WORKER POOL
//
//  Each slot holds the Worker and an idle flag.
//  The onmessage handler is set up per-slot so we can
//  reference the slot directly — avoids the `this` trap
//  that breaks pool.find() inside arrow functions.
// ──────────────────────────────────────────────────────────
const TILE         = 64;
const WORKER_COUNT = navigator.hardwareConcurrency || 4;

let tileQueue  = [];
let tilesTotal = 0;
let tilesDone  = 0;

function currentZoom() {
  return (DEFAULT.xMax - DEFAULT.xMin) / (view.xMax - view.xMin);
}

function dispatchNext(slot) {
  if (tileQueue.length === 0) {
    slot.idle = true;
    return;
  }
  slot.idle = false;
  const tile = tileQueue.shift();
  // All world-space params come from the tile descriptor (snapshotted at
  // render() time) — not from live globals. This is what prevents the
  // jumbled tile bug: if view changes mid-render, in-flight tiles still
  // use the params they were enqueued with.
  slot.worker.postMessage({
    renderID:   tile.renderID,
    px0: tile.px0, py0: tile.py0,
    pw:  tile.pw,  ph:  tile.ph,
    W:   tile.W,   H:   tile.H,
    xMin: tile.xMin, xMax: tile.xMax,
    yMin: tile.yMin, yMax: tile.yMax,
    maxIter: tile.maxIter,
  });
}

// Build pool after dispatchNext is defined.
// Each worker's onmessage closes over its own slot — no `this` needed.
const pool = Array.from({ length: WORKER_COUNT }, () => {
  const slot   = { worker: null, idle: true };
  const worker = new Worker('mandelbrot.worker.js');

  worker.onmessage = function(e) {
    const { renderID, px0, py0, pw, ph, buffer } = e.data;

    // Drop result if a newer render has superseded this one
    if (renderID !== currentRenderID) {
      dispatchNext(slot);
      return;
    }

    // Blit pixel data onto the canvas
    const imgData = new ImageData(new Uint8ClampedArray(buffer), pw, ph);
    ctx.putImageData(imgData, px0, py0);

    tilesDone++;
    if (tilesDone === tilesTotal) {
      spinner.classList.remove('active');
    }

    dispatchNext(slot);
  };

  slot.worker = worker;
  return slot;
});

// ──────────────────────────────────────────────────────────
//  RENDER ENTRY POINT
// ──────────────────────────────────────────────────────────
let currentRenderID = 0;

function render() {
  const id = ++renderID;
  currentRenderID = id;

  const W = canvas.width, H = canvas.height;

  // Snapshot all mutable state right now. Every tile in this render
  // carries its own copy, so dispatchNext never touches live globals.
  const xMin     = view.xMin, xMax = view.xMax;
  const yMin     = view.yMin, yMax = view.yMax;
  const snapIter = maxIter;

  spinner.classList.add('active');
  updateHUD();

  const tilesX = Math.ceil(W / TILE);
  const tilesY = Math.ceil(H / TILE);
  tilesTotal = tilesX * tilesY;
  tilesDone  = 0;
  tileQueue  = [];

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const px0 = tx * TILE;
      const py0 = ty * TILE;
      tileQueue.push({
        renderID,
        px0, py0,
        pw: Math.min(TILE, W - px0),
        ph: Math.min(TILE, H - py0),
        W, H,
        xMin, xMax,
        yMin, yMax,
        maxIter: snapIter,
      });
    }
  }

  // Seed each worker with its first tile; they self-feed from there
  for (const slot of pool) {
    if (tileQueue.length === 0) break;
    dispatchNext(slot);
  }
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 30);
}

// ──────────────────────────────────────────────────────────
//  HUD
// ──────────────────────────────────────────────────────────
function updateHUD(mouseRe, mouseIm) {
  const cx        = (view.xMin + view.xMax) / 2;
  const cy        = (view.yMin + view.yMax) / 2;
  const initRange = DEFAULT.xMax - DEFAULT.xMin;
  const curRange  = view.xMax - view.xMin;
  const zoom      = initRange / curRange;

  iCx.textContent   = (mouseRe !== undefined ? mouseRe : cx).toExponential(8);
  iCy.textContent   = (mouseIm !== undefined ? mouseIm : cy).toExponential(8);
  iZoom.textContent = zoom < 1e4
    ? zoom.toFixed(2) + '×'
    : zoom.toExponential(3) + '×';
  iIter.textContent = maxIter;

  if (zoom > 1e9) {
    badge.textContent = 'PERTURBATION · ' + WORKER_COUNT + ' WORKERS';
    badge.classList.remove('warn');
  } else {
    badge.textContent = 'FLOAT64 · ' + WORKER_COUNT + ' WORKERS';
    badge.classList.remove('warn');
  }
}

// ──────────────────────────────────────────────────────────
//  RESIZE
// ──────────────────────────────────────────────────────────
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  scheduleRender();
}
window.addEventListener('resize', resize);

// ──────────────────────────────────────────────────────────
//  COORDINATE HELPERS
// ──────────────────────────────────────────────────────────
function screenToWorld(sx, sy) {
  const W = canvas.width, H = canvas.height;
  return [
    view.xMin + sx / W * (view.xMax - view.xMin),
    view.yMax - sy / H * (view.yMax - view.yMin),
  ];
}

// ──────────────────────────────────────────────────────────
//  ZOOM
// ──────────────────────────────────────────────────────────
function zoomAt(sx, sy, factor) {
  const [wx, wy]  = screenToWorld(sx, sy);
  const newXRange = (view.xMax - view.xMin) * factor;
  const newYRange = (view.yMax - view.yMin) * factor;
  view.xMin = wx - (sx / canvas.width)  * newXRange;
  view.xMax = view.xMin + newXRange;
  view.yMax = wy + (sy / canvas.height) * newYRange;
  view.yMin = view.yMax - newYRange;
  scheduleRender();
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

// ──────────────────────────────────────────────────────────
//  PAN
// ──────────────────────────────────────────────────────────
let dragging = false, dragStart = null, viewAtDrag = null;

canvas.addEventListener('mousedown', e => {
  dragging   = true;
  dragStart  = [e.clientX, e.clientY];
  viewAtDrag = { ...view };
});

window.addEventListener('mousemove', e => {
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  updateHUD(wx, wy);

  chH.style.display = chV.style.display = 'block';
  chH.style.top  = e.clientY + 'px';
  chV.style.left = e.clientX + 'px';

  if (!dragging) return;
  const dx     = e.clientX - dragStart[0];
  const dy     = e.clientY - dragStart[1];
  const xRange = viewAtDrag.xMax - viewAtDrag.xMin;
  const yRange = viewAtDrag.yMax - viewAtDrag.yMin;
  view.xMin = viewAtDrag.xMin - dx / canvas.width  * xRange;
  view.xMax = view.xMin + xRange;
  view.yMax = viewAtDrag.yMax + dy / canvas.height * yRange;
  view.yMin = view.yMax - yRange;
  scheduleRender();
});

window.addEventListener('mouseup',  () => { dragging = false; });
canvas.addEventListener('mouseleave', () => {
  chH.style.display = chV.style.display = 'none';
});

// ──────────────────────────────────────────────────────────
//  BUTTONS
// ──────────────────────────────────────────────────────────
document.getElementById('btn-reset').addEventListener('click', () => {
  view           = { ...DEFAULT };
  maxIter        = 256;
  // Cancel any in-flight render and clear the queue
  currentRenderID = ++renderID;
  tileQueue       = [];
  tilesDone       = 0;
  tilesTotal      = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  scheduleRender();
});
document.getElementById('btn-iter-up').addEventListener('click', () => {
  maxIter = Math.min(maxIter * 2, 16384);
  scheduleRender();
});
document.getElementById('btn-iter-dn').addEventListener('click', () => {
  maxIter = Math.max(maxIter / 2, 32);
  scheduleRender();
});

// ──────────────────────────────────────────────────────────
//  BOOT
// ──────────────────────────────────────────────────────────
resize();
