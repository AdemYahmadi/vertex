// Browser port of the Python scan pipeline (src/core + DocAligner heatmap
// inference). Every step mirrors the Python code so results stay comparable;
// the matching Python line is noted where the translation is not obvious.
//
// All functions take an OpenCV.js instance `cv` and BGR cv.Mat inputs, like
// cv2 in Python. Callers own (and must .delete()) every Mat they get back.

export const MODEL_INPUT_SIZE = 256;
const HEATMAP_THRESHOLD = 0.3;

export class NoDocumentError extends Error {
  constructor() {
    super("Failed to detect document boundary.");
    this.name = "NoDocumentError";
  }
}

// ---------------------------------------------------------------------------
// Detection (docaligner/heatmap_reg/infer.py)
// ---------------------------------------------------------------------------

// preprocess(): bilinear resize to 256x256, HWC BGR uint8 -> NCHW float / 255.
export function toModelInput(cv, bgr) {
  const resized = new cv.Mat();
  cv.resize(
    bgr,
    resized,
    new cv.Size(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
    0,
    0,
    cv.INTER_LINEAR,
  );
  const plane = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const out = new Float32Array(3 * plane);
  const px = resized.data;
  for (let i = 0; i < plane; i++) {
    out[i] = px[i * 3] / 255;
    out[plane + i] = px[i * 3 + 1] / 255;
    out[2 * plane + i] = px[i * 3 + 2] / 255;
  }
  resized.delete();
  return out;
}

// _get_point_with_max_area(): centroid of the largest external contour, or
// null when there is none or several share the max area (Python then yields
// more than two numbers and the corner is dropped).
function largestBlobCentroid(cv, mask) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
    mask,
    contours,
    hierarchy,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE,
  );
  let best = [];
  let bestArea = -Infinity;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    // from_image() drops <2 points, drop_empty() drops <3.
    if (c.rows >= 3) {
      const m = cv.moments(c, false);
      if (m.m00 > bestArea) {
        bestArea = m.m00;
        best = [m];
      } else if (m.m00 === bestArea) {
        best.push(m);
      }
    }
    c.delete();
  }
  contours.delete();
  hierarchy.delete();
  if (best.length !== 1) return null;
  const m = best[0];
  return [m.m10 / (m.m00 + 1e-5), m.m01 / (m.m00 + 1e-5)];
}

// postprocess(): one heatmap per corner, upscaled to the image size,
// thresholded, Otsu-binarized, then the biggest blob's centroid.
export function heatmapsToCorners(cv, heatmap, dims, width, height) {
  const [, channels, hh, hw] = dims;
  const plane = hh * hw;
  const corners = [];
  for (let ch = 0; ch < Math.min(channels, 4); ch++) {
    const pred = cv.matFromArray(
      hh,
      hw,
      cv.CV_32F,
      heatmap.subarray(ch * plane, (ch + 1) * plane),
    );
    const up = new cv.Mat();
    cv.resize(pred, up, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
    pred.delete();

    // pred[pred < 0.3] = 0
    const f = up.data32F;
    for (let i = 0; i < f.length; i++) if (f[i] < HEATMAP_THRESHOLD) f[i] = 0;

    // np.uint8(pred * 255) truncates; the -0.5 offset turns convertTo's
    // rounding into truncation.
    const u8 = new cv.Mat();
    up.convertTo(u8, cv.CV_8U, 255, -0.5);
    up.delete();

    const bin = new cv.Mat();
    cv.threshold(u8, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    u8.delete();

    const point = largestBlobCentroid(cv, bin);
    bin.delete();
    if (point) corners.push(point);
  }
  return corners;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// geometry.get_document_contours()
export async function detectCorners(cv, runModel, bgr) {
  if (!bgr || bgr.empty()) return null;
  const { data, dims } = await runModel(toModelInput(cv, bgr));
  const corners = heatmapsToCorners(cv, data, dims, bgr.cols, bgr.rows);
  if (corners.length !== 4) return null;
  if (polygonArea(corners) < 1) return null;
  return corners;
}

// ---------------------------------------------------------------------------
// Perspective correction (src/core/geometry.py)
// ---------------------------------------------------------------------------

function argmin(arr) {
  let k = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[k]) k = i;
  return k;
}

function argmax(arr) {
  let k = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[k]) k = i;
  return k;
}

export function orderPoints(pts) {
  const sum = pts.map(([x, y]) => x + y);
  const diff = pts.map(([x, y]) => y - x);
  return [
    pts[argmin(sum)],
    pts[argmin(diff)],
    pts[argmax(sum)],
    pts[argmax(diff)],
  ];
}

export function warpPerspective(cv, bgr, points, ordered = false) {
  const [tl, tr, br, bl] = ordered ? points : orderPoints(points);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const maxWidth = Math.max(Math.trunc(dist(br, bl)), Math.trunc(dist(tr, tl)));
  const maxHeight = Math.max(
    Math.trunc(dist(tr, br)),
    Math.trunc(dist(tl, bl)),
  );
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [tl, tr, br, bl].flat());
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    maxWidth - 1,
    0,
    maxWidth - 1,
    maxHeight - 1,
    0,
    maxHeight - 1,
  ]);
  const M = cv.getPerspectiveTransform(src, dst);
  const out = new cv.Mat();
  cv.warpPerspective(bgr, out, M, new cv.Size(maxWidth, maxHeight));
  src.delete();
  dst.delete();
  M.delete();
  return out;
}

// ---------------------------------------------------------------------------
// Enhancement (src/core/enhancement.py)
// ---------------------------------------------------------------------------

function trimBackground(
  cv,
  bgr,
  paperV = 150,
  paperS = 65,
  need = 0.55,
  maxFrac = 0.15,
) {
  const hsv = new cv.Mat();
  cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);
  const w = bgr.cols,
    h = bgr.rows;
  const col = new Float64Array(w);
  const row = new Float64Array(h);
  const px = hsv.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (px[i + 2] > paperV && px[i + 1] < paperS) {
        col[x]++;
        row[y]++;
      }
    }
  }
  hsv.delete();
  for (let x = 0; x < w; x++) col[x] /= h;
  for (let y = 0; y < h; y++) row[y] /= w;

  const first = (arr, limit, reverse) => {
    for (let i = 0; i < arr.length; i++) {
      const val = arr[reverse ? arr.length - 1 - i : i];
      if (val >= need) return i;
      if (i >= limit) break;
    }
    return 0;
  };
  const left = first(col, Math.trunc(w * maxFrac), false);
  const right = first(col, Math.trunc(w * maxFrac), true);
  const top = first(row, Math.trunc(h * maxFrac), false);
  const bottom = first(row, Math.trunc(h * maxFrac), true);

  const rw = w - right - left,
    rh = h - bottom - top;
  if (rw <= 0 || rh <= 0) return bgr.clone();
  // copyTo, not clone(): this OpenCV.js build's clone() ignores the ROI's row
  // stride and returns a sheared image.
  const view = bgr.roi(new cv.Rect(left, top, rw, rh));
  const trimmed = new cv.Mat();
  view.copyTo(trimmed);
  view.delete();
  return trimmed;
}

// numpy float32 -> uint8 casts truncate toward zero.
const f32 = Math.fround;

export function enhanceDocument(cv, input, trim = true) {
  const image = trim ? trimBackground(cv, input) : input.clone();
  const w = image.cols,
    h = image.rows,
    n = w * h;

  const gray = new cv.Mat();
  cv.cvtColor(image, gray, cv.COLOR_BGR2GRAY);

  // Background estimate on a quarter-size copy.
  const small = new cv.Mat();
  cv.resize(gray, small, new cv.Size(0, 0), 0.25, 0.25, cv.INTER_LINEAR);
  const kernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE,
    new cv.Size(15, 15),
  );
  const dilated = new cv.Mat();
  cv.morphologyEx(small, dilated, cv.MORPH_DILATE, kernel);
  small.delete();
  kernel.delete();
  const blurredBg = new cv.Mat();
  cv.medianBlur(dilated, blurredBg, 21);
  dilated.delete();
  const bg = new cv.Mat();
  cv.resize(blurredBg, bg, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  blurredBg.delete();

  const normMat = new cv.Mat();
  cv.divide(gray, bg, normMat, 255);
  bg.delete();
  const out = new cv.Mat(h, w, cv.CV_8UC3);

  // Typed-array views into the wasm heap go stale whenever OpenCV allocates
  // (the heap can grow), so take them only after the Mats above exist.
  const norm = normMat.data;
  const g = gray.data;
  const src = image.data;
  let dst = out.data;

  // Levels: black point 25, white point 200, then whiten paper.
  const blackPt = 25,
    whitePt = 200;
  const span = f32(255 / (whitePt - blackPt));
  const paper = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let v = f32(f32(norm[i] - blackPt) * span);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    v = Math.trunc(v);
    if (v > 210) {
      paper[i] = 1;
      v = 255;
    }
    norm[i] = v;
  }

  // Apply the gray-level gain to each color channel.
  for (let i = 0; i < n; i++) {
    const gain = f32(norm[i] / (g[i] < 1 ? 1 : g[i]));
    for (let c = 0; c < 3; c++) {
      let v = f32(src[i * 3 + c] * gain);
      dst[i * 3 + c] = v > 255 ? 255 : Math.trunc(v);
    }
  }
  gray.delete();
  normMat.delete();
  image.delete();

  // Saturation boost.
  const hsv = new cv.Mat();
  cv.cvtColor(out, hsv, cv.COLOR_BGR2HSV);
  const hp = hsv.data;
  for (let i = 0; i < n; i++) {
    const s = f32(hp[i * 3 + 1] * f32(1.35));
    hp[i * 3 + 1] = s > 255 ? 255 : Math.trunc(s);
  }
  cv.cvtColor(hsv, out, cv.COLOR_HSV2BGR);
  hsv.delete();
  dst = out.data;
  for (let i = 0; i < n; i++) {
    if (paper[i]) dst[i * 3] = dst[i * 3 + 1] = dst[i * 3 + 2] = 255;
  }

  // Unsharp mask, then edge-preserving smoothing.
  const blur = new cv.Mat();
  cv.GaussianBlur(out, blur, new cv.Size(0, 0), 1.2);
  const sharp = new cv.Mat();
  cv.addWeighted(out, 1.6, blur, -0.6, 0, sharp);
  blur.delete();
  out.delete();
  const result = new cv.Mat();
  cv.bilateralFilter(sharp, result, 5, 25, 25);
  sharp.delete();
  return result;
}

// ---------------------------------------------------------------------------
// src/processor.py
// ---------------------------------------------------------------------------

export async function detectDocument(cv, runModel, bgr) {
  const corners = await detectCorners(cv, runModel, bgr);
  return corners && orderPoints(corners);
}

export async function scanDocument(
  cv,
  runModel,
  bgr,
  corners = null,
  trim = true,
) {
  let warped;
  if (corners) {
    warped = warpPerspective(cv, bgr, corners, true);
  } else {
    const found = await detectCorners(cv, runModel, bgr);
    if (!found) throw new NoDocumentError();
    warped = warpPerspective(cv, bgr, found);
  }
  try {
    return enhanceDocument(cv, warped, trim);
  } finally {
    warped.delete();
  }
}
