import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  UploadCloud,
  ScanLine,
  Download,
  Layers,
  Crop,
  ShieldCheck,
  Loader2,
  X,
  AlertCircle,
  RotateCwSquare,
} from "lucide-react";

const GitHubIcon = ({ size = 14 }) => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 012-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const VertexMark = ({ size = 22 }) => (
  <svg
    className="vx-mark"
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="var(--accent)"
    aria-hidden="true"
  >
    <path d="M24.84 61.4 L33.14 53.92 L30.25 42.33 L21.95 49.81 Z" />
    <path d="M20.97 45.89 L29.28 38.42 L24.88 20.8 L16.58 28.28 Z" />
    <path d="M36.14 51.23 L39.83 47.9 L35.89 32.1 L47.42 21.71 L43.1 4.4 L27.88 18.1 Z" />
  </svg>
);

const USE_MOCK = false;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/scan";
const MAX_SIDE = import.meta.env.DEV ? 0 : 1800;
const IS_HOSTED = import.meta.env.VITE_HOSTED === "true";

const HEALTH_URL = (() => {
  try {
    return new URL("/health", new URL(API_URL, window.location.href)).href;
  } catch {
    return "";
  }
})();
const SCAN_TIMEOUT_MS = 120000;
const WAKE_TIMEOUT_MS = 90000;
const RETRY_DELAY_MS = 1500;

let wakeInFlight = null;

function wakeApi() {
  if (!HEALTH_URL) return Promise.resolve();
  if (!wakeInFlight) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS);
    wakeInFlight = fetch(HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
    })
      .catch(() => {})
      .then(() => {
        clearTimeout(timer);
        wakeInFlight = null;
      });
  }
  return wakeInFlight;
}

const SCAN_MESSAGES = {
  413: "That image is too large. Try a smaller photo.",
  415: "Unsupported file type. Please upload a JPG or PNG.",
  422: "We couldn't find a document in that photo. Make sure the whole page is visible against a contrasting background, with even lighting.",
  429: "Too many scans at once. Please wait a moment and try again.",
  502: "The scanner is waking up or busy. Please try again in a few seconds.",
  503: "The scanner is starting up. Please try again in a few seconds.",
};

const COLD_START_STATUSES = new Set([429, 502, 503, 504]);

async function downscale(file, maxSide) {
  if (!maxSide) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const longest = Math.max(img.width, img.height);
    if (longest <= maxSide) return file;
    const scale = maxSide / longest;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92),
    );
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
      type: "image/jpeg",
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function postScan(file) {
  const form = new FormData();
  form.append("file", await downscale(file, MAX_SIDE));
  const sep = API_URL.includes("?") ? "&" : "?";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${sep}fmt=png`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function scanDocument(file) {
  if (USE_MOCK) return mockScan(file);

  const attempts = 2;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLast = attempt === attempts - 1;
    let res;
    try {
      res = await postScan(file);
    } catch (err) {
      lastError = new Error(
        err?.name === "AbortError"
          ? "The scanner took too long to respond. Please try again."
          : "Couldn't reach the scanner. Check your connection and try again.",
      );
      if (isLast) throw lastError;
      await wakeApi();
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    if (res.ok) return res.blob();

    let detail = "";
    try {
      detail = (await res.json())?.detail || "";
    } catch {}
    lastError = new Error(
      detail ||
        SCAN_MESSAGES[res.status] ||
        "Something went wrong while scanning. Please try again.",
    );

    if (!isLast && COLD_START_STATUSES.has(res.status)) {
      await wakeApi();
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    throw lastError;
  }

  throw lastError;
}

function mockScan(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1500;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale),
        h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h),
        p = data.data;
      const blackPt = 25,
        whitePt = 200,
        span = 255 / (whitePt - blackPt);
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i],
          g = p[i + 1],
          b = p[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let nl = (lum - blackPt) * span;
        nl = nl < 0 ? 0 : nl > 255 ? 255 : nl;
        if (nl > 210) {
          p[i] = p[i + 1] = p[i + 2] = 255;
        } else {
          const gn = nl / Math.max(lum, 1);
          p[i] = Math.min(255, r * gn * 1.05);
          p[i + 1] = Math.min(255, g * gn * 1.05);
          p[i + 2] = Math.min(255, b * gn * 1.15);
        }
      }
      ctx.putImageData(data, 0, 0);
      setTimeout(
        () =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Encoding failed"))),
            "image/png",
          ),
        900,
      );
    };
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = URL.createObjectURL(file);
  });
}

async function encodeJpeg(blob, rotation = 0) {
  const url = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  URL.revokeObjectURL(url);
  const sideways = rotation % 180 !== 0;
  const W = sideways ? img.naturalHeight : img.naturalWidth,
    H = sideways ? img.naturalWidth : img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const raw = atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
  const jpeg = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) jpeg[i] = raw.charCodeAt(i) & 0xff;
  return { jpeg, W, H };
}

async function imagesToPdfBlob(items) {
  const pages = [];
  for (const it of items)
    pages.push(await encodeJpeg(it.resultBlob, it.rotation));
  const N = pages.length,
    parts = [],
    off = [];
  let len = 0;
  const toBytes = (s) => {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  };
  const push = (b) => {
    parts.push(b);
    len += b.length;
  };
  const pushStr = (s) => push(toBytes(s));
  const begin = (n) => {
    off[n] = len;
  };
  pushStr("%PDF-1.4\n");
  begin(1);
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  begin(2);
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${N} >>\nendobj\n`);
  pages.forEach((pg, i) => {
    const pageN = 3 + i * 3,
      imgN = 4 + i * 3,
      contN = 5 + i * 3;
    begin(pageN);
    pushStr(
      `${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.W} ${pg.H}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>\nendobj\n`,
    );
    begin(imgN);
    pushStr(
      `${imgN} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.W} /Height ${pg.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
    );
    push(pg.jpeg);
    pushStr("\nendstream\nendobj\n");
    const content = `q ${pg.W} 0 0 ${pg.H} 0 0 cm /Im0 Do Q`;
    begin(contN);
    pushStr(
      `${contN} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
  });
  const totalObjs = 2 + N * 3,
    xrefStart = len;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjs; n++)
    xref += String(off[n]).padStart(10, "0") + " 00000 n \n";
  pushStr(xref);
  pushStr(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`,
  );
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return new Blob([out], { type: "application/pdf" });
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function makeZip(files) {
  const enc = new TextEncoder(),
    chunks = [],
    central = [];
  let offset = 0;
  const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n) =>
    new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);
  const push = (a) => {
    chunks.push(a);
    offset += a.length;
  };
  for (const f of files) {
    const nameBytes = enc.encode(f.name),
      crc = crc32(f.bytes),
      size = f.bytes.length,
      lo = offset;
    push(u32(0x04034b50));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(crc));
    push(u32(size));
    push(u32(size));
    push(u16(nameBytes.length));
    push(u16(0));
    push(nameBytes);
    push(f.bytes);
    central.push({ nameBytes, crc, size, lo });
  }
  const cs = offset;
  for (const c of central) {
    push(u32(0x02014b50));
    push(u16(20));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(c.crc));
    push(u32(c.size));
    push(u32(c.size));
    push(u16(c.nameBytes.length));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(0));
    push(u32(c.lo));
    push(c.nameBytes);
  }
  const csize = offset - cs;
  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(central.length));
  push(u16(central.length));
  push(u32(csize));
  push(u32(cs));
  push(u16(0));
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return new Blob([out], { type: "application/zip" });
}

const ACCEPT = ["image/jpeg", "image/png"];

function revokeUrls(list) {
  list.forEach((i) => {
    if (i.originalUrl) URL.revokeObjectURL(i.originalUrl);
    if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
  });
}

let _id = 0;

const HOW = [
  {
    icon: UploadCloud,
    t: "Upload",
    d: "Drop one or more photos of your documents — any angle, any lighting.",
  },
  {
    icon: ScanLine,
    t: "Scan",
    d: "Vertex detects each page, corrects the perspective, and cleans the image.",
  },
  {
    icon: Download,
    t: "Download",
    d: "Export a single PDF, or a whole batch bundled into one folder.",
  },
];

const FEATURES = [
  {
    icon: Layers,
    t: "Reliable detection",
    d: "A deep-learning model finds the page against cluttered backgrounds and uneven lighting, where classic edge detection breaks down.",
  },
  {
    icon: Crop,
    t: "Accurate flattening",
    d: "Perspective correction warps any angle or paper size into a clean, upright rectangle, then sharpens the ink for legibility.",
  },
  {
    icon: ShieldCheck,
    t: "Private by default",
    d: "Photos are processed in memory and discarded as soon as the scan returns. PDFs are assembled locally in your browser, and nothing is stored on a server.",
  },
];

export default function VertexScanner() {
  const [items, setItems] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exportMode, setExportMode] = useState("merged");
  const [selectedId, setSelectedId] = useState(null);
  const [rescanTick, setRescanTick] = useState(0);
  const [moveMsg, setMoveMsg] = useState("");
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const settling = useRef(false);
  const stripRef = useRef(null);
  const thumbRefs = useRef(new Map());
  const focusAfterMove = useRef(null);

  const patch = useCallback((id, next) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...next } : it)),
    );
  }, []);

  const addFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []).filter((f) =>
        ACCEPT.includes(f.type),
      );
      if (!files.length) return;
      if (!USE_MOCK) wakeApi();
      const created = files.map((file) => {
        const id = ++_id;
        const originalUrl = URL.createObjectURL(file);
        const probe = new Image();
        probe.onload = () =>
          patch(id, { dims: { w: probe.width, h: probe.height } });
        probe.src = originalUrl;
        return {
          id,
          file,
          name: file.name,
          originalUrl,
          dims: null,
          state: "pending",
          resultBlob: null,
          resultUrl: null,
          rotation: 0,
          error: "",
        };
      });
      setItems((prev) => [...prev, ...created]);
    },
    [patch],
  );

  const spins = useRef(new Map());
  const [resultSize, setResultSize] = useState(null);
  const [surface, setSurface] = useState(null);
  const surfaceObserver = useRef(null);

  const surfaceRef = useCallback((el) => {
    surfaceObserver.current?.disconnect();
    surfaceObserver.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSurface({ w: width, h: height });
    });
    ro.observe(el);
    surfaceObserver.current = ro;
  }, []);

  const rotatePage = useCallback((id) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (!it) return;
    spins.current.set(id, (spins.current.get(id) ?? it.rotation) + 90);
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, rotation: (i.rotation + 90) % 360 } : i,
      ),
    );
  }, []);

  const removeItem = useCallback((id) => {
    spins.current.delete(id);
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone?.originalUrl) URL.revokeObjectURL(gone.originalUrl);
      if (gone?.resultUrl) URL.revokeObjectURL(gone.resultUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const moveTo = useCallback((id, to) => {
    const from = itemsRef.current.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= itemsRef.current.length || to === from)
      return;
    setItems((prev) => {
      const at = prev.findIndex((i) => i.id === id);
      if (at < 0 || to >= prev.length) return prev;
      const next = [...prev];
      next.splice(to, 0, next.splice(at, 1)[0]);
      return next;
    });
    setSelectedId(id);
    setMoveMsg(`Page ${from + 1} moved to position ${to + 1}`);
  }, []);

  const endGesture = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    clearTimeout(d.timer);
    window.removeEventListener("pointermove", d.onMove);
    window.removeEventListener("pointerup", d.onUp);
    window.removeEventListener("pointercancel", d.onCancel);
    dragRef.current = null;
  }, []);

  const startGesture = useCallback(
    (e, id, from) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (settling.current) return;
      endGesture();
      const strip = stripRef.current;
      const touch = e.pointerType !== "mouse";
      const d = {
        id,
        from,
        to: from,
        x0: e.clientX,
        y0: e.clientY,
        scroll0: strip.scrollLeft,
        pointerId: e.pointerId,
        active: false,
        timer: null,
        slot: 66,
      };

      const pickUp = () => {
        const thumbs = strip.querySelectorAll(".vx-thumb");
        if (thumbs.length > 1)
          d.slot = thumbs[1].offsetLeft - thumbs[0].offsetLeft;
        d.active = true;
        setDrag({ id, from, to: from, dx: 0, slot: d.slot });
      };

      const update = (x) => {
        const r = strip.getBoundingClientRect();
        if (x < r.left + 28) strip.scrollLeft -= 8;
        else if (x > r.right - 28) strip.scrollLeft += 8;
        const dx = x - d.x0 + strip.scrollLeft - d.scroll0;
        const n = itemsRef.current.length;
        d.to = Math.max(0, Math.min(n - 1, from + Math.round(dx / d.slot)));
        setDrag({ id, from, to: d.to, dx, slot: d.slot });
      };

      d.onMove = (ev) => {
        if (ev.pointerId !== d.pointerId) return;
        const mx = ev.clientX - d.x0;
        const my = ev.clientY - d.y0;
        if (!d.active) {
          if (touch) {
            if (Math.hypot(mx, my) > 8) endGesture();
            return;
          }
          if (Math.hypot(mx, my) < 4) return;
          pickUp();
        }
        update(ev.clientX);
      };
      d.onUp = (ev) => {
        if (ev.pointerId !== d.pointerId) return;
        if (d.active) {
          settling.current = true;
          setDrag((prev) => prev && { ...prev, dropped: true });
          setTimeout(() => {
            moveTo(id, d.to);
            setDrag(null);
            settling.current = false;
          }, 140);
        }
        endGesture();
      };
      d.onCancel = (ev) => {
        if (ev.pointerId !== d.pointerId) return;
        setDrag(null);
        endGesture();
      };

      if (touch) d.timer = setTimeout(pickUp, 350);
      dragRef.current = d;
      window.addEventListener("pointermove", d.onMove);
      window.addEventListener("pointerup", d.onUp);
      window.addEventListener("pointercancel", d.onCancel);
    },
    [endGesture, moveTo],
  );

  useEffect(() => {
    const block = (e) => {
      if (dragRef.current?.active) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      document.removeEventListener("touchmove", block);
      endGesture();
    };
  }, [endGesture]);

  useEffect(() => {
    const id = focusAfterMove.current;
    if (id == null) return;
    focusAfterMove.current = null;
    thumbRefs.current.get(id)?.focus();
  }, [items]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const scanAll = useCallback(async () => {
    setProcessing(true);
    const pending = items.filter((i) => i.state === "pending");
    for (const it of pending) {
      patch(it.id, { state: "processing" });
      try {
        const blob = await scanDocument(it.file);
        patch(it.id, {
          state: "done",
          resultBlob: blob,
          resultUrl: URL.createObjectURL(blob),
        });
      } catch (err) {
        patch(it.id, { state: "error", error: err.message || "Scan failed" });
      }
    }
    setProcessing(false);
  }, [items, patch]);

  const rescanAll = useCallback(() => {
    setRescanTick((t) => t + 1);
    setItems((prev) =>
      prev.map((it) => {
        if (it.state !== "done") return it;
        if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
        return { ...it, state: "pending", resultBlob: null, resultUrl: null };
      }),
    );
  }, []);

  const downloadAll = useCallback(async () => {
    const done = items.filter((i) => i.state === "done" && i.resultBlob);
    if (!done.length) return;
    setDownloading(true);
    try {
      if (done.length === 1) {
        const pdf = await imagesToPdfBlob([done[0]]);
        saveBlob(pdf, `${done[0].name.replace(/\.[^.]+$/, "")}.pdf`);
        return;
      }
      const d = new Date();
      const date = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
      const pdf = await imagesToPdfBlob(done);
      saveBlob(pdf, `vertex-scan-${date}.pdf`);
    } finally {
      setDownloading(false);
    }
  }, [items]);

  const downloadSeparate = useCallback(async () => {
    const done = items.filter((i) => i.state === "done" && i.resultBlob);
    if (done.length < 2) return;
    setDownloading(true);
    try {
      const folder = "vertex-scans",
        files = [];
      for (let i = 0; i < done.length; i++) {
        const it = done[i];
        const pdf = await imagesToPdfBlob([it]);
        const bytes = new Uint8Array(await pdf.arrayBuffer());
        files.push({
          name: `${folder}/${String(i + 1).padStart(2, "0")}-${it.name.replace(/\.[^.]+$/, "")}.pdf`,
          bytes,
        });
      }
      saveBlob(makeZip(files), `${folder}.zip`);
    } finally {
      setDownloading(false);
    }
  }, [items]);

  const reset = useCallback(() => {
    spins.current.clear();
    setItems((prev) => {
      revokeUrls(prev);
      return [];
    });
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      revokeUrls(itemsRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!USE_MOCK) wakeApi();
  }, []);

  const selected = items.find((i) => i.id === selectedId) || items[0] || null;
  const angleOf = (it) => spins.current.get(it.id) ?? it.rotation;

  let resultScale = 1;
  if (
    selected?.rotation % 180 &&
    surface &&
    resultSize?.url === selected.resultUrl
  ) {
    const fit = Math.min(1, surface.w / resultSize.w, surface.h / resultSize.h);
    const dw = resultSize.w * fit;
    const dh = resultSize.h * fit;
    resultScale = Math.min(1, surface.w / dh, surface.h / dw);
  }

  const canRotate = selected?.state === "done";
  const selectedIdForKeys = canRotate ? selected.id : null;
  useEffect(() => {
    if (selectedIdForKeys == null) return;
    const onKey = (e) => {
      if (e.key !== "r" && e.key !== "R") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      e.preventDefault();
      rotatePage(selectedIdForKeys);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIdForKeys, rotatePage]);

  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!items.some((i) => i.id === selectedId)) setSelectedId(items[0].id);
  }, [items, selectedId]);

  const scanAllRef = useRef(scanAll);
  scanAllRef.current = scanAll;

  useEffect(() => {
    if (rescanTick > 0) scanAllRef.current();
  }, [rescanTick]);

  const view = items.length === 0 ? "landing" : "workspace";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  const doneCount = items.filter((i) => i.state === "done").length;
  const pendingCount = items.filter((i) => i.state === "pending").length;
  const errorCount = items.filter((i) => i.state === "error").length;
  const exportSeparate = exportMode === "separate" && doneCount > 1;
  const phase = processing
    ? "processing"
    : items.every((i) => i.state === "done" || i.state === "error")
      ? "done"
      : "ready";
  const stepIndex = phase === "done" && doneCount > 0 ? 2 : 1;
  const year = new Date().getFullYear();

  const scrollToId = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="vx">
      <style>{CSS}</style>

      <header className="vx-nav">
        <div className="vx-nav-in">
          <button
            className="vx-brand"
            onClick={view === "workspace" ? reset : undefined}
          >
            <VertexMark size={25} />
            Vertex
          </button>
          <nav className="vx-nav-r">
            {view === "landing" ? (
              <>
                <a className="vx-link" href="#how" onClick={scrollToId("how")}>
                  How it works
                </a>
                <a
                  className="vx-link"
                  href="#features"
                  onClick={scrollToId("features")}
                >
                  Features
                </a>
              </>
            ) : (
              <button className="vx-link" onClick={reset}>
                Start over
              </button>
            )}
            <a
              className="vx-link vx-link-icon"
              href="https://github.com/AdemYahmadi/vertex"
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon /> GitHub
            </a>
          </nav>
        </div>
      </header>

      {view === "landing" && (
        <main className="vx-main">
          <div className="vx-top">
            <section className="vx-hero">
              <p className="vx-kicker">Document scanner</p>
              <h1 className="vx-h1">
                Turn photos of paper into scanner-quality PDFs.
              </h1>
              <p className="vx-lead">
                Vertex detects the document in a photo, corrects the
                perspective, cleans the lighting, and exports a crisp PDF. It
                handles complex backgrounds and any paper size, and never keeps
                a copy of your files.
              </p>
            </section>

            <section className="vx-upload">
              <div
                className={`vx-drop ${dragging ? "is-drag" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
              >
                <span className="vx-drop-badge">
                  <UploadCloud size={22} strokeWidth={1.75} />
                </span>
                <p className="vx-drop-t">Drop documents to scan</p>
                <button
                  type="button"
                  className="vx-cta-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  Choose photos
                </button>
                <p className="vx-drop-d">
                  or drag and drop JPG or PNG files here
                </p>
              </div>
              {IS_HOSTED && (
                <div className="vx-note">
                  <a
                    className="vx-note-link"
                    href="https://github.com/AdemYahmadi/vertex#cli"
                    target="_blank"
                    rel="noreferrer"
                  >
                    For the best results, use the Vertex CLI
                    <span aria-hidden="true"> →</span>
                  </a>
                  <p className="vx-note-d">
                    It scans at full resolution with the most accurate model.
                    The browser version uses a lightweight model and scales
                    images to {MAX_SIDE}px for faster scanning — photograph
                    pages against a plain background for the most reliable
                    detection.
                  </p>
                </div>
              )}
            </section>
          </div>

          <section className="vx-sec" id="how">
            <h2 className="vx-sec-h">How it works</h2>
            <ol className="vx-grid-3 vx-steps-list">
              {HOW.map((s, i) => (
                <li className="vx-stepc" key={s.t}>
                  <span className="vx-stepc-n">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="vx-cell-h">{s.t}</h3>
                  <p className="vx-cell-d">{s.d}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="vx-sec" id="features">
            <h2 className="vx-sec-h">Built for real-world documents</h2>
            <div className="vx-grid-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div className="vx-cell vx-card" key={f.t}>
                    <span className="vx-cell-ic">
                      <Icon size={18} strokeWidth={1.75} />
                    </span>
                    <h3 className="vx-cell-h">{f.t}</h3>
                    <p className="vx-cell-d">{f.d}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {view === "workspace" && selected && (
        <main className="vx-main vx-main-ws">
          <div className="vx-ws-bar">
            <h1 className="vx-ws-title">
              Pages
              {items.length > 1 && (
                <span className="vx-ws-hint">Press and hold to reorder</span>
              )}
            </h1>
            <ol className="vx-flow" aria-label="Progress">
              {["Upload", "Scan", "Download"].map((label, i) => (
                <li
                  key={label}
                  className={`vx-flow-step ${i < stepIndex ? "done" : i === stepIndex ? "on" : ""}`}
                >
                  {label}
                </li>
              ))}
            </ol>
          </div>

          {items.length > 1 && (
            <div
              ref={stripRef}
              className={`vx-strip ${drag ? (drag.dropped ? "is-dropping" : "is-dragging") : ""}`}
              role="group"
              aria-label="Pages"
            >
              {items.map((it, i) => {
                const on = it.id === selected.id;
                const lifted = drag?.id === it.id;
                let shift = 0;
                if (drag && !lifted) {
                  if (drag.from < drag.to && i > drag.from && i <= drag.to)
                    shift = -drag.slot;
                  else if (drag.to < drag.from && i >= drag.to && i < drag.from)
                    shift = drag.slot;
                }
                return (
                  <div
                    key={it.id}
                    className={`vx-thumb ${on ? "on" : ""} ${lifted ? "is-lifted" : ""}`}
                    style={
                      lifted
                        ? {
                            transform: drag.dropped
                              ? `translateX(${(drag.to - drag.from) * drag.slot}px)`
                              : `translate(${drag.dx}px, -3px)`,
                          }
                        : shift
                          ? { transform: `translateX(${shift}px)` }
                          : undefined
                    }
                    onPointerDown={(e) => startGesture(e, it.id, i)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <button
                      ref={(el) => {
                        if (el) thumbRefs.current.set(it.id, el);
                        else thumbRefs.current.delete(it.id);
                      }}
                      className="vx-thumb-btn"
                      aria-current={on ? "true" : undefined}
                      aria-label={`Page ${i + 1}`}
                      aria-describedby="vx-reorder-help"
                      title={`Page ${i + 1} · ${it.name}`}
                      onClick={() => setSelectedId(it.id)}
                      onKeyDown={(e) => {
                        if (!e.altKey) return;
                        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                          return;
                        e.preventDefault();
                        focusAfterMove.current = it.id;
                        moveTo(it.id, i + (e.key === "ArrowLeft" ? -1 : 1));
                      }}
                    >
                      <img
                        src={it.resultUrl || it.originalUrl}
                        alt=""
                        draggable={false}
                        style={
                          it.resultUrl && angleOf(it)
                            ? {
                                transform: `rotate(${angleOf(it)}deg)${
                                  it.rotation % 180 ? " scale(1.29)" : ""
                                }`,
                              }
                            : undefined
                        }
                      />
                      {it.state === "processing" && (
                        <span className="vx-thumb-busy">
                          <Loader2
                            size={14}
                            className="vx-spin"
                            strokeWidth={2}
                          />
                        </span>
                      )}
                      <span
                        className={`vx-thumb-n ${
                          it.state === "done"
                            ? "ok"
                            : it.state === "error"
                              ? "err"
                              : ""
                        }`}
                      >
                        {i + 1}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <span id="vx-reorder-help" className="vx-sr">
            Alt plus arrow keys to move this page.
          </span>
          <span className="vx-sr" aria-live="polite">
            {moveMsg}
          </span>

          <section className="vx-ws">
            <header className="vx-doc-head">
              <div className="vx-doc-meta">
                <span className="vx-doc-name" title={selected.name}>
                  {selected.name}
                </span>
                <span className="vx-doc-sub">
                  {selected.dims
                    ? `${selected.dims.w} × ${selected.dims.h}`
                    : "Reading size…"}
                  {" · "}
                  {(selected.name.split(".").pop() || "").toUpperCase()}
                </span>
              </div>
              {!processing && (
                <button
                  className="vx-remove"
                  title="Remove page"
                  onClick={() => removeItem(selected.id)}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </header>

            <div className="vx-compare">
              <figure className="vx-pane">
                <figcaption className="vx-pane-label">
                  <span>Original</span>
                </figcaption>
                <div className="vx-pane-surface">
                  <img
                    src={selected.originalUrl}
                    alt="Original"
                    className="vx-doc"
                  />
                </div>
              </figure>

              <figure className="vx-pane">
                <figcaption className="vx-pane-label">
                  <span
                    className={selected.state === "done" ? "vx-scanned" : ""}
                  >
                    {selected.state === "done"
                      ? "Result"
                      : selected.state === "processing"
                        ? "Scanning"
                        : selected.state === "error"
                          ? "Error"
                          : "Preview"}
                  </span>
                  {canRotate && selected.rotation !== 0 && (
                    <span className="vx-pane-rot">{selected.rotation}°</span>
                  )}
                  {canRotate && (
                    <div
                      className="vx-pane-tools"
                      role="toolbar"
                      aria-label="Page tools"
                    >
                      <button
                        className="vx-tool"
                        aria-label="Rotate page 90° clockwise"
                        aria-keyshortcuts="R"
                        title="Rotate 90° clockwise (R)"
                        onClick={() => rotatePage(selected.id)}
                      >
                        <RotateCwSquare size={14} strokeWidth={1.75} />
                        Rotate
                      </button>
                    </div>
                  )}
                </figcaption>
                <div className="vx-pane-surface" ref={surfaceRef}>
                  {selected.state === "done" && (
                    <img
                      key={selected.id}
                      src={selected.resultUrl}
                      alt="Scanned"
                      className="vx-doc vx-doc-rot"
                      style={
                        angleOf(selected)
                          ? {
                              transform: `rotate(${angleOf(selected)}deg) scale(${resultScale})`,
                            }
                          : undefined
                      }
                      onLoad={(e) =>
                        setResultSize({
                          url: selected.resultUrl,
                          w: e.currentTarget.naturalWidth,
                          h: e.currentTarget.naturalHeight,
                        })
                      }
                    />
                  )}
                  {selected.state === "processing" && (
                    <div className="vx-state">
                      <Loader2 size={18} className="vx-spin" strokeWidth={2} />
                      <p className="vx-state-d">
                        Correcting perspective and lighting…
                      </p>
                    </div>
                  )}
                  {selected.state === "pending" && (
                    <div className="vx-state">
                      <ScanLine
                        size={18}
                        strokeWidth={1.75}
                        className="vx-state-ic"
                      />
                      <p className="vx-state-t">Preview</p>
                      <p className="vx-state-d">
                        Your cleaned page will appear here after scanning.
                      </p>
                    </div>
                  )}
                  {selected.state === "error" && (
                    <div className="vx-state">
                      <AlertCircle
                        size={18}
                        strokeWidth={2}
                        className="vx-state-ic err"
                      />
                      <p className="vx-state-t">Could not scan</p>
                      <p className="vx-state-d">{selected.error}</p>
                    </div>
                  )}
                </div>
              </figure>
            </div>
          </section>

          <div className="vx-ws-actions">
            <div className="vx-ws-meta">
              <span className="vx-ws-status" aria-live="polite">
                {phase === "processing" ? (
                  <>
                    <Loader2 size={14} className="vx-spin" strokeWidth={2} />
                    Scanning {Math.min(doneCount + 1, items.length)} of{" "}
                    {items.length}…
                  </>
                ) : phase === "done" ? (
                  doneCount > 0 ? (
                    `${doneCount} ${doneCount === 1 ? "page" : "pages"} scanned`
                  ) : (
                    "Nothing scanned yet"
                  )
                ) : (
                  `${pendingCount} ${pendingCount === 1 ? "page" : "pages"} selected`
                )}
              </span>
              {phase === "done" && doneCount > 0 && errorCount > 0 && (
                <span className="vx-ws-note">
                  {errorCount} {errorCount === 1 ? "page" : "pages"} couldn't be
                  scanned and won't be included.
                </span>
              )}
            </div>

            {phase !== "processing" && (
              <div className="vx-ws-tools">
                <button
                  className="vx-btn vx-btn-secondary"
                  onClick={() => inputRef.current?.click()}
                >
                  Add pages
                </button>
                {phase === "done" && doneCount > 0 && (
                  <button
                    className="vx-btn vx-btn-secondary"
                    onClick={rescanAll}
                  >
                    Scan again
                  </button>
                )}
              </div>
            )}

            {phase !== "processing" && (
              <div className="vx-ws-export">
                {phase === "ready" && (
                  <button className="vx-btn vx-btn-primary" onClick={scanAll}>
                    Scan {pendingCount > 1 ? `${pendingCount} pages` : "page"}
                  </button>
                )}
                {phase === "done" && doneCount === 0 && (
                  <button className="vx-btn vx-btn-primary" onClick={rescanAll}>
                    Try again
                  </button>
                )}
                {phase === "done" && doneCount > 1 && (
                  <div
                    className="vx-seg"
                    role="radiogroup"
                    aria-label="Download as"
                  >
                    {[
                      ["merged", "One PDF"],
                      ["separate", "Separate PDFs"],
                    ].map(([value, label]) => (
                      <label
                        key={value}
                        className={`vx-seg-opt ${exportMode === value ? "on" : ""}`}
                      >
                        <input
                          type="radio"
                          name="vx-export"
                          value={value}
                          checked={exportMode === value}
                          disabled={downloading}
                          onChange={() => setExportMode(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
                {phase === "done" && doneCount > 0 && (
                  <button
                    className="vx-btn vx-btn-primary vx-btn-download"
                    onClick={exportSeparate ? downloadSeparate : downloadAll}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <Loader2 size={14} className="vx-spin" strokeWidth={2} />
                    ) : (
                      <Download size={14} strokeWidth={2} />
                    )}
                    <span>
                      {downloading
                        ? "Preparing…"
                        : exportSeparate
                          ? `Download ${doneCount} PDFs (.zip)`
                          : "Download PDF"}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
      )}

      <footer
        className={`vx-footer ${view === "workspace" ? "vx-footer-quiet" : ""}`}
      >
        <div className="vx-footer-in">
          <p className="vx-copy">
            © {year} Vertex — made for cleaner documents.
          </p>
          <nav className="vx-footer-links">
            <a
              className="vx-link"
              href="https://github.com/AdemYahmadi/vertex"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a
              className="vx-link"
              href="https://github.com/AdemYahmadi/vertex/issues"
              target="_blank"
              rel="noreferrer"
            >
              Report an issue
            </a>
            <a
              className="vx-link"
              href="https://github.com/AdemYahmadi/vertex#readme"
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
          </nav>
        </div>
      </footer>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const CSS = `
.vx{
  --bg:#F6F6F7; --surface:#FFFFFF; --panel:#F1F1F2;
  --text:#18181B; --text-2:#3F3F46; --muted:#71717A; --faint:#A1A1AA;
  --border:#E4E4E7; --border-2:#D4D4D8;
  --accent:#0B6E52; --accent-ink:#075A42; --accent-soft:#EDF4F1;
  --danger:#B91C1C; --danger-soft:#FBEEEE;
  --radius:5px; --radius-lg:12px;
  --ring:0 0 0 3px rgba(11,110,82,.18);
  color:var(--text); background:var(--bg); min-height:100%;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Roboto,sans-serif;
  font-size:13.5px; line-height:1.5; -webkit-font-smoothing:antialiased;
  letter-spacing:-.003em;
  display:flex; flex-direction:column;
}
.vx *{box-sizing:border-box;}
.vx ::selection{background:rgba(11,110,82,.16);}

.vx-nav{position:sticky; top:0; z-index:30; background:var(--bg); border-bottom:1px solid var(--border);}
.vx-nav-in{max-width:1040px; margin:0 auto; height:48px; padding:0 clamp(16px,4vw,32px); display:flex; align-items:center; justify-content:space-between;}
.vx-brand{display:inline-flex; align-items:center; gap:1px; background:none; border:0; padding:0; cursor:pointer; font-weight:600; font-size:14.5px; letter-spacing:-.01em; color:var(--text); font-family:inherit;}
.vx-mark{display:block; flex:none;}
.vx-nav-r{display:flex; align-items:center; gap:2px;}
.vx-link{display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; color:var(--muted); text-decoration:none; padding:5px 8px; border-radius:var(--radius); background:none; border:0; cursor:pointer; font-family:inherit; transition:color .1s, background .1s;}
.vx-link:hover{color:var(--text); background:rgba(24,24,27,.05);}
.vx-link:focus-visible, .vx-brand:focus-visible{outline:none; box-shadow:var(--ring); border-radius:var(--radius);}
.vx-link-icon{color:var(--text-2);}
@media (max-width:560px){ .vx-nav-r .vx-link:not(.vx-link-icon){display:none;} }

.vx-main{flex:1; width:100%; max-width:1040px; margin:0 auto; padding:clamp(36px,6vw,68px) clamp(16px,4vw,32px) clamp(48px,6vw,72px);}
.vx-main-ws{max-width:1040px; padding-top:clamp(16px,2.4vw,22px); padding-bottom:32px;}

.vx-top{display:grid; grid-template-columns:minmax(0,1fr); gap:clamp(28px,4vw,40px); margin-bottom:clamp(30px,4.5vw,48px);}
@media (min-width:900px){
  .vx-top{grid-template-columns:minmax(0,1fr) 420px; gap:clamp(40px,5vw,72px); align-items:center;}
}
@media (min-width:1200px){ .vx-top{grid-template-columns:minmax(0,1fr) 440px;} }

.vx-hero{max-width:560px; min-width:0;}
.vx-kicker{font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--accent); margin:0 0 14px;}
.vx-h1{font-size:clamp(28px,3.6vw,38px); font-weight:600; line-height:1.15; letter-spacing:-.022em; margin:0 0 16px; color:var(--text); text-wrap:balance;}
.vx-lead{font-size:clamp(15px,1.5vw,16.5px); line-height:1.55; color:var(--text-2); margin:0; max-width:52ch;}

.vx-upload{min-width:0;}
.vx-drop{display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;
  min-height:230px; padding:36px 28px; background:var(--surface);
  border:1px dashed var(--border-2); border-radius:var(--radius-lg); cursor:pointer;
  transition:border-color .12s, background .12s;}
.vx-drop:hover{border-color:var(--accent); background:var(--accent-soft);}
.vx-drop.is-drag{border-color:var(--accent); background:var(--accent-soft); border-style:solid;}
.vx-drop:focus-visible{outline:none; border-color:var(--accent); box-shadow:var(--ring);}
.vx-drop-badge{display:grid; place-items:center; width:30px; height:30px; margin-bottom:14px; color:var(--muted);}
.vx-drop:hover .vx-drop-badge, .vx-drop.is-drag .vx-drop-badge{color:var(--accent);}
.vx-drop-t{font-size:16px; font-weight:600; letter-spacing:-.01em; color:var(--text); margin:0 0 18px;}
.vx-cta-btn{font-family:inherit; font-size:13.5px; font-weight:600; letter-spacing:-.005em; color:#fff;
  background:var(--accent); border:0; border-radius:6px; padding:10px 18px; cursor:pointer;
  transition:background .12s ease;}
.vx-cta-btn:hover{background:var(--accent-ink);}
.vx-cta-btn:focus-visible{outline:none; box-shadow:var(--ring);}
.vx-drop-d{font-size:13px; color:var(--muted); margin:14px 0 0;}
.vx-note{margin:14px 2px 0;}
.vx-note-link{display:inline-block; font-size:12.5px; font-weight:600; letter-spacing:-.005em; color:var(--accent); text-decoration:none;}
.vx-note-link:hover{text-decoration:underline; text-underline-offset:2px;}
.vx-note-link:focus-visible{outline:none; box-shadow:var(--ring); border-radius:3px;}
.vx-note-d{margin:4px 0 0; font-size:12px; line-height:1.55; color:var(--muted);}

.vx-sec{padding-top:clamp(28px,4vw,44px); border-top:1px solid var(--border);}
.vx-sec + .vx-sec{margin-top:clamp(30px,4.5vw,48px);}
.vx-sec-h{font-size:clamp(17px,2vw,20px); font-weight:600; line-height:1.3; letter-spacing:-.018em; color:var(--text); margin:0 0 clamp(22px,2.6vw,30px);}
.vx-grid-3{display:grid; grid-template-columns:1fr; gap:clamp(20px,3vw,28px);}
@media (min-width:720px){ .vx-grid-3{grid-template-columns:repeat(3,1fr); gap:32px;} }
.vx-cell{min-width:0;}
.vx-steps-list{list-style:none; margin:0; padding:0;}
.vx-stepc{min-width:0; padding-top:14px; border-top:1px solid var(--border-2);}
.vx-stepc-n{display:block; margin-bottom:12px; font-size:11.5px; font-weight:600;
  letter-spacing:.08em; color:var(--accent); font-variant-numeric:tabular-nums;}
.vx-card{background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:22px 20px;}
.vx-cell-ic{display:grid; place-items:center; width:20px; height:20px; color:var(--accent); margin-bottom:12px;}
.vx-cell-h{font-size:15px; font-weight:600; color:var(--text); margin:0 0 8px; letter-spacing:-.012em;}
.vx-cell-d{font-size:14px; line-height:1.6; color:var(--muted); margin:0;}

.vx-ws-bar{display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding-bottom:12px; margin-bottom:clamp(16px,2.4vw,24px); border-bottom:1px solid var(--border);}
.vx-ws-title{display:inline-flex; align-items:baseline; gap:7px; margin:0; padding:2px 0; color:var(--text-2); font-size:12.5px; font-weight:600; line-height:1.5; letter-spacing:-.005em;}

.vx-flow{display:flex; align-items:center; gap:7px; list-style:none; margin:0; padding:0; flex:none;}
.vx-flow-step{display:inline-flex; align-items:center; font-size:11px; letter-spacing:.02em; color:var(--faint); transition:color .12s ease;}
.vx-flow-step + .vx-flow-step::before{content:"→"; margin-right:7px; color:var(--border-2);}
.vx-flow-step.done{color:var(--muted);}
.vx-flow-step.on{color:var(--accent); font-weight:600;}
@media (max-width:620px){ .vx-flow{display:none;} }

.vx-ws{min-width:0;}
.vx-doc-head{display:flex; align-items:center; gap:8px; margin-bottom:12px;}
.vx-doc-meta{flex:0 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px;}
.vx-doc-name{font-size:14px; font-weight:600; line-height:1.35; color:var(--text); letter-spacing:-.01em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.vx-doc-sub{font-size:12px; line-height:1.35; color:var(--muted); font-variant-numeric:tabular-nums;}
.vx-sr{position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;}
.vx-ws-hint{display:none; font-size:11.5px; font-weight:400; color:var(--faint);}
@media (pointer:coarse){ .vx-ws-hint{display:inline;} }

.vx-strip{display:flex; align-items:flex-start; gap:10px; overflow-x:auto; padding:6px 3px 10px; margin:-3px -3px clamp(8px,1.4vw,12px); scrollbar-width:thin;}
.vx-thumb{position:relative; flex:none; width:56px; height:72px; touch-action:manipulation;
  -webkit-user-select:none; user-select:none; -webkit-touch-callout:none;}
.vx-strip.is-dragging .vx-thumb{transition:transform .16s ease;}
.vx-strip.is-dragging .vx-thumb.is-lifted{z-index:2; transition:none;}
.vx-strip.is-dropping .vx-thumb.is-lifted{z-index:2; transition:transform .12s ease;}
.vx-strip.is-dragging, .vx-strip.is-dragging .vx-thumb-btn{cursor:grabbing;}
.vx-thumb-btn{position:relative; display:block; width:100%; height:100%; padding:0; overflow:hidden; font-family:inherit;
  background:var(--surface); border:1px solid var(--border-2); border-radius:4px; cursor:grab;
  transition:border-color .12s ease, box-shadow .12s ease; -webkit-tap-highlight-color:transparent;}
.vx-thumb-btn:hover{border-color:var(--faint); box-shadow:0 1px 2px rgba(16,16,20,.05);}
.vx-thumb-btn:focus-visible{outline:none; box-shadow:var(--ring);}
.vx-thumb.on .vx-thumb-btn{border-color:var(--accent); box-shadow:0 0 0 1px var(--accent);}
.vx-thumb.on .vx-thumb-btn:focus-visible{box-shadow:0 0 0 1px var(--accent), var(--ring);}
.vx-thumb.is-lifted .vx-thumb-btn{box-shadow:0 4px 12px rgba(16,16,20,.14);}
.vx-thumb.on.is-lifted .vx-thumb-btn{box-shadow:0 0 0 1px var(--accent), 0 4px 12px rgba(16,16,20,.14);}
.vx-thumb-btn img{display:block; width:100%; height:100%; object-fit:cover; pointer-events:none; transition:transform .15s ease;}
.vx-thumb-busy{position:absolute; inset:0; display:grid; place-items:center; background:color-mix(in srgb, var(--surface) 65%, transparent);}
.vx-thumb-n{position:absolute; left:3px; bottom:3px; min-width:16px; height:16px; padding:0 4px; display:grid; place-items:center;
  font-size:10.5px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; color:var(--text-2);
  background:var(--surface); border:1px solid var(--border); border-radius:3px;}
.vx-thumb-n.ok{color:var(--accent);}
.vx-thumb-n.err{color:var(--danger);}
.vx-doc-head .vx-remove{margin-left:0;}
.vx-remove{display:grid; place-items:center; width:24px; height:24px; cursor:pointer; background:none; border:0; border-radius:4px; color:var(--faint); opacity:.6; transition:opacity .12s ease, color .12s ease, background .12s ease; flex:none;}
.vx-remove:hover{opacity:1; color:var(--danger); background:var(--danger-soft);}
.vx-remove:focus-visible{outline:none; opacity:1; box-shadow:var(--ring);}

.vx-compare{display:grid; grid-template-columns:minmax(0,1fr); gap:clamp(16px,2.4vw,24px);}
@media (min-width:860px){ .vx-compare{grid-template-columns:repeat(2,minmax(0,1fr));} }
.vx-pane{margin:0; min-width:0;}
.vx-pane-label{display:flex; align-items:center; gap:5px; min-height:22px; margin-bottom:8px; font-size:10.5px; font-weight:600; color:var(--faint); letter-spacing:.06em; text-transform:uppercase;}
.vx-scanned{color:var(--accent); font-weight:600;}
.vx-pane-rot{font-size:10.5px; font-weight:500; color:var(--faint); letter-spacing:0; font-variant-numeric:tabular-nums;}
.vx-pane-tools{margin-left:auto; display:flex; align-items:center; gap:2px;}
.vx-tool{display:inline-flex; align-items:center; gap:5px; height:22px; padding:0 7px 0 6px; font-family:inherit; font-size:11.5px; font-weight:500;
  letter-spacing:0; text-transform:none; color:var(--muted); background:none; border:0; border-radius:4px; cursor:pointer;
  transition:color .12s ease, background .12s ease;}
.vx-tool svg{color:var(--faint); transition:color .12s ease;}
@media (hover:hover){
  .vx-tool:hover{color:var(--text); background:rgba(24,24,27,.05);}
  .vx-tool:hover svg{color:var(--text-2);}
}
.vx-tool:active{color:var(--text); background:rgba(24,24,27,.05);}
.vx-tool:focus-visible{outline:none; box-shadow:var(--ring);}
@media (pointer:coarse){ .vx-tool{height:30px; padding:0 10px 0 8px; font-size:12.5px;} }
.vx-doc-rot{transition:transform .15s ease;}
.vx-pane-surface{position:relative; display:flex; align-items:center; justify-content:center;
  height:clamp(340px,54vh,600px); padding:12px; background:var(--surface);
  border:1px solid var(--border); border-radius:var(--radius-lg);}
.vx-doc{max-width:100%; max-height:100%; object-fit:contain; box-shadow:0 0 0 1px rgba(16,16,20,.07),0 1px 2px rgba(16,16,20,.05);}

.vx-state{display:flex; flex-direction:column; align-items:center; text-align:center; max-width:290px; padding:0 8px;}
.vx-state-ic{color:var(--faint);}
.vx-state-ic.err{color:var(--danger);}
.vx-state-t{margin:11px 0 0; font-size:13px; font-weight:600; color:var(--text-2);}
.vx-state .vx-spin + .vx-state-d{margin-top:12px;}
.vx-state-d{margin:5px 0 0; font-size:12.5px; line-height:1.55; color:var(--muted);}
.vx-state .vx-btn{margin-top:16px;}

.vx-ws-actions{position:sticky; bottom:0; z-index:20; display:flex; flex-wrap:wrap; align-items:center; gap:14px;
  margin-top:clamp(16px,2.4vw,24px); padding:12px 0; background:var(--bg); border-top:1px solid var(--border);}
.vx-ws-meta{display:flex; flex-direction:column; gap:2px; min-width:0;}
.vx-ws-status{display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-2); font-variant-numeric:tabular-nums;}
.vx-ws-note{font-size:12px; line-height:1.4; color:var(--muted);}
.vx-ws-tools{display:flex; align-items:center; gap:8px;}
.vx-ws-export{display:flex; align-items:center; gap:8px; margin-left:auto;}

.vx-seg{display:inline-flex; align-items:stretch; height:32px; padding:2px; gap:2px; background:var(--panel); border:1px solid var(--border); border-radius:6px;}
.vx-seg-opt{position:relative; display:inline-flex; align-items:center; justify-content:center; padding:0 10px; border-radius:4px;
  font-size:12.5px; font-weight:500; letter-spacing:-.003em; line-height:1; color:var(--muted); white-space:nowrap; cursor:pointer; user-select:none;
  transition:color .12s ease, background .12s ease;}
.vx-seg-opt input{position:absolute; width:1px; height:1px; margin:0; opacity:0; pointer-events:none;}
.vx-seg-opt:hover{color:var(--text);}
.vx-seg-opt.on{color:var(--text); background:var(--surface); box-shadow:0 0 0 1px var(--border-2);}
.vx-seg-opt:has(input:focus-visible){box-shadow:var(--ring);}
.vx-seg-opt.on:has(input:focus-visible){box-shadow:0 0 0 1px var(--border-2), var(--ring);}
.vx-seg-opt:has(input:disabled){opacity:.5; cursor:default;}

.vx-btn{display:inline-flex; align-items:center; justify-content:center; gap:6px; height:32px; padding:0 13px; font-family:inherit; font-size:12.5px; font-weight:500; letter-spacing:-.003em; border-radius:6px; border:1px solid transparent; cursor:pointer; transition:background .12s ease, border-color .12s ease, color .12s ease;}
.vx-btn:focus-visible{outline:none; box-shadow:var(--ring);}
.vx-btn-primary{background:var(--accent); color:#fff; font-weight:600;}
.vx-btn-primary:hover:not(:disabled){background:var(--accent-ink);}
.vx-btn-primary:disabled{opacity:.5; cursor:default;}
.vx-btn-secondary{background:none; color:var(--muted); border-color:var(--border-2);}
.vx-btn-secondary:hover{border-color:var(--faint); color:var(--text);}
.vx-btn-secondary:disabled{opacity:.5; cursor:default;}
.vx-btn-download{gap:7px;}
.vx-spin{animation:vx-rot .8s linear infinite; color:var(--accent);}
@keyframes vx-rot{to{transform:rotate(360deg);}}

@media (max-width:859px){
  .vx-pane-surface{height:clamp(320px,46vh,460px);}
}
@media (max-width:620px){
  .vx-ws-actions{flex-direction:column; align-items:stretch; gap:10px;}
  .vx-ws-export{order:1; margin-left:0; display:grid; grid-template-columns:minmax(0,1fr); gap:8px;}
  .vx-ws-tools{order:2; display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:8px;}
  .vx-seg{height:40px;}
  .vx-seg-opt{flex:1 1 0; font-size:13px;}
  .vx-btn{height:40px; padding:0 15px; font-size:13px;}
  .vx-pane-surface{height:clamp(300px,44vh,400px);}
}

.vx-footer{border-top:1px solid var(--border);}
.vx-footer-in{max-width:1040px; margin:0 auto; padding:16px clamp(16px,4vw,32px); display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;}
.vx-copy{font-size:12px; color:var(--faint); margin:0;}
.vx-footer-links{display:flex; align-items:center; gap:4px;}
.vx-footer-quiet{border-top-color:var(--border);}
.vx-footer-quiet .vx-footer-in{padding-top:12px; padding-bottom:12px;}
.vx-footer-quiet .vx-copy{font-size:11px; color:var(--faint);}
.vx-footer-quiet .vx-link{font-size:11px; color:var(--faint);}
.vx-footer-quiet .vx-link:hover{color:var(--muted); background:none;}

@media (max-width:560px){
  .vx-actions .vx-btn{flex:1 1 auto;}
  .vx-footer-in{justify-content:flex-start;}
}
@media (prefers-reduced-motion:reduce){ .vx-spin{animation-duration:1.6s;} .vx-skel{animation:none;} .vx-btn,.vx-link,.vx-drop{transition:none;} }
`;
