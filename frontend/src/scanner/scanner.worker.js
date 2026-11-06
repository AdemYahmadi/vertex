// Runs the scan pipeline off the main thread. Loads OpenCV.js, the ONNX
// runtime and the DocAligner model once, then handles one scan at a time.

import * as ort from "onnxruntime-web/wasm";
// Static import on purpose: opencv-js exports a Promise, and Vite's CommonJS
// wrapper makes a dynamic import() of it resolve to a broken thenable.
import cvReady from "@techstark/opencv-js";
import { detectDocument, scanDocument, NoDocumentError } from "./pipeline.js";
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm?url";

const MODEL_URL = "/models/docaligner-fastvit_t8.onnx";

// Threads need cross-origin isolation, which would block Google Fonts.
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { "ort-wasm-simd.wasm": ortWasmUrl };

let ready = null;

function load() {
  if (!ready) {
    ready = (async () => {
      const [cv, session] = await Promise.all([
        cvReady,
        ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ["wasm"],
        }),
      ]);
      const runModel = async (input) => {
        const tensor = new ort.Tensor("float32", input, [1, 3, 256, 256]);
        const { heatmap } = await session.run({ img: tensor });
        return { data: heatmap.data, dims: heatmap.dims };
      };
      return { cv, runModel };
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

async function decode(file, maxSide) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (maxSide && Math.max(width, height) > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

async function encodePng(cv, bgr) {
  const rgba = new cv.Mat();
  cv.cvtColor(bgr, rgba, cv.COLOR_BGR2RGBA);
  const image = new ImageData(
    new Uint8ClampedArray(rgba.data),
    rgba.cols,
    rgba.rows,
  );
  rgba.delete();
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d").putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function decodeBgr(cv, file, maxSide) {
  const pixels = await decode(file, maxSide);
  const rgba = cv.matFromImageData(pixels);
  const bgr = new cv.Mat();
  cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR);
  rgba.delete();
  return bgr;
}

// Corners come back normalized to 0..1, ordered TL, TR, BR, BL.
async function detect(file, maxSide) {
  const { cv, runModel } = await load();
  const bgr = await decodeBgr(cv, file, maxSide);
  const width = bgr.cols,
    height = bgr.rows;
  try {
    const corners = await detectDocument(cv, runModel, bgr);
    return {
      width,
      height,
      corners: corners && corners.map(([x, y]) => [x / width, y / height]),
    };
  } finally {
    bgr.delete();
  }
}

async function scan(file, maxSide, corners, trim = true) {
  const { cv, runModel } = await load();
  const bgr = await decodeBgr(cv, file, maxSide);
  const quad = corners && corners.map(([x, y]) => [x * bgr.cols, y * bgr.rows]);
  let result;
  try {
    result = await scanDocument(cv, runModel, bgr, quad, trim);
  } finally {
    bgr.delete();
  }
  try {
    return await encodePng(cv, result);
  } finally {
    result.delete();
  }
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === "warm") {
      await load();
      self.postMessage({ id, ok: true });
    } else if (type === "detect") {
      const result = await detect(data.file, data.maxSide);
      self.postMessage({ id, ok: true, result });
    } else if (type === "scan") {
      const result = await scan(
        data.file,
        data.maxSide,
        data.corners,
        data.trim,
      );
      self.postMessage({ id, ok: true, result });
    }
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      noDocument: err instanceof NoDocumentError,
      message: err?.message || String(err),
    });
  }
};
