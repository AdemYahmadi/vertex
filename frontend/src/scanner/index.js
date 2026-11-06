// Main-thread handle for the scanner worker.

let worker = null;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./scanner.worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.ok) job.resolve(data.result);
      else job.reject(Object.assign(new Error(data.message), data));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || "Scanner failed to load.");
      for (const job of pending.values()) job.reject(err);
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  return worker;
}

function call(message) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...message, id });
  });
}

// Start downloading the model and runtimes before the first scan.
export function warmScanner() {
  return call({ type: "warm" }).catch(() => {});
}

export function detectLocally(file, maxSide) {
  return call({ type: "detect", file, maxSide });
}

export function scanLocally(file, maxSide, corners, trim = true) {
  return call({ type: "scan", file, maxSide, corners, trim });
}
