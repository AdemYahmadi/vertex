import React, { useState, useRef, useCallback, useEffect } from "react";
import "./vertex.css";
import {
  UploadCloud,
  ScanLine,
  Download,
  Layers,
  Crop,
  ShieldCheck,
  Loader2,
  AlertCircle,
  RotateCwSquare,
  ArrowDown,
  GripVertical,
  TriangleAlert,
  Trash2,
  Check,
  Plus,
  RefreshCw,
  ArrowRight,
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
    fill="var(--primary)"
    aria-hidden="true"
  >
    <path d="M24.84 61.4 L33.14 53.92 L30.25 42.33 L21.95 49.81 Z" />
    <path d="M20.97 45.89 L29.28 38.42 L24.88 20.8 L16.58 28.28 Z" />
    <path d="M36.14 51.23 L39.83 47.9 L35.89 32.1 L47.42 21.71 L43.1 4.4 L27.88 18.1 Z" />
  </svg>
);

const DropArt = () => (
  <svg
    className="vx-drop-art"
    viewBox="0 0 240 120"
    width="240"
    height="120"
    aria-hidden="true"
  >
    <rect className="vx-art-desk" x="6" y="12" width="96" height="96" rx="6" />
    <path className="vx-art-paper" d="M24 28 L88 20 L84 100 L28 104 Z" />
    <path
      className="vx-art-line"
      d="M36 40 L76 35 M36 50 L77 45 M35 60 L76 55 M35 70 L75 65 M34 80 L62 77"
    />
    <path className="vx-art-arrow" d="M114 60 H134 M128 53 L135 60 L128 67" />
    <rect
      className="vx-art-shadow"
      x="155"
      y="16"
      width="70"
      height="96"
      rx="2"
    />
    <g>
      <rect
        className="vx-art-sheet"
        x="152"
        y="12"
        width="70"
        height="96"
        rx="2"
      />
    </g>
    <path
      className="vx-art-text"
      d="M162 30 H196 M162 42 H212 M162 52 H212 M162 62 H208 M162 72 H212 M162 82 H190"
    />
  </svg>
);

const USE_MOCK = false;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/scan";
const HOSTED_MAX_SIDE = 1800;
const MAX_SIDE = import.meta.env.DEV ? 0 : HOSTED_MAX_SIDE;
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
    d: "Add one or more photos. Any angle, any lighting.",
  },
  {
    icon: ScanLine,
    t: "Scan",
    d: "Vertex finds each page, straightens it and cleans it up.",
  },
  {
    icon: Download,
    t: "Download",
    d: "Get one combined PDF, or separate PDFs in a single .zip.",
  },
];

const FEATURES = [
  {
    icon: Layers,
    t: "Reliable detection",
    d: "A deep-learning model finds the page on cluttered backgrounds and in uneven light, where classic edge detection fails.",
  },
  {
    icon: Crop,
    t: "Accurate flattening",
    d: "Perspective correction turns any angle or paper size into an upright rectangle, then sharpens the ink.",
  },
  {
    icon: ShieldCheck,
    t: "Private by default",
    d: "Photos are processed in memory and discarded once the scan returns. PDFs are built in your browser. Nothing is stored on a server.",
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
  const [notice, setNotice] = useState("");
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
      const all = Array.from(fileList || []);
      const files = all.filter((f) => ACCEPT.includes(f.type));
      const skipped = all.filter((f) => !ACCEPT.includes(f.type));
      setNotice(
        skipped.length
          ? `${
              skipped.length === 1
                ? `${skipped[0].name} isn't a JPG or PNG, so it wasn't added.`
                : `${skipped.length} files aren't JPG or PNG, so they weren't added.`
            }${
              skipped.some(
                (f) => /\.hei[cf]$/i.test(f.name) || /hei[cf]/.test(f.type),
              )
                ? " Convert HEIC photos to JPG first, or set iPhone Settings → Camera → Formats → Most Compatible."
                : ""
            }`
          : "",
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
      if (itemsRef.current.length)
        setSelectedId(created[created.length - 1].id);
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
    const strip = stripRef.current;
    const thumb = thumbRefs.current.get(selectedId)?.parentElement;
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft;
    const right = left + thumb.offsetWidth;
    const pad = 8;
    if (left - pad < strip.scrollLeft)
      strip.scrollTo({ left: left - pad, behavior: "smooth" });
    else if (right + pad > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({
        left: right + pad - strip.clientWidth,
        behavior: "smooth",
      });
  }, [selectedId, items.length]);

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
    setNotice("");
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

  const fitBox = (w, h) => {
    if (!surface || !w || !h) return undefined;
    const k = Math.min(surface.w / w, surface.h / h);
    return { width: Math.round(w * k), height: Math.round(h * k) };
  };
  const originalBox = fitBox(selected?.dims?.w, selected?.dims?.h);
  const resultBox =
    resultSize && resultSize.url === selected?.resultUrl
      ? fitBox(resultSize.w, resultSize.h)
      : undefined;
  let resultScale = 1;
  if (selected?.rotation % 180 && resultBox) {
    resultScale = Math.min(
      1,
      surface.w / resultBox.height,
      surface.h / resultBox.width,
    );
  }

  const canRotate = selected?.state === "done";
  const selectedIdForKeys = canRotate ? selected.id : null;
  useEffect(() => {
    if (selectedIdForKeys == null) return;
    const onKey = (e) => {
      if (e.key !== "r" && e.key !== "R") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
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

  const keysId = view === "workspace" && selected ? selected.id : null;
  useEffect(() => {
    if (keysId == null) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const list = itemsRef.current;
        const next =
          list.findIndex((i) => i.id === keysId) +
          (e.key === "ArrowLeft" ? -1 : 1);
        if (next < 0 || next >= list.length) return;
        e.preventDefault();
        const id = list[next].id;
        setSelectedId(id);
        if (stripRef.current?.contains(document.activeElement))
          thumbRefs.current.get(id)?.focus();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !e.repeat &&
        !processing
      ) {
        e.preventDefault();
        removeItem(keysId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysId, processing, removeItem]);

  const [activeSec, setActiveSec] = useState("");
  useEffect(() => {
    if (view !== "landing") return;
    const ids = ["top", "how", "features"];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries)
          if (en.isIntersecting)
            setActiveSec(en.target.id === "top" ? "" : en.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
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
  const progress = items.length
    ? Math.min(doneCount, items.length) / items.length
    : 0;

  const scrollToId = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="vx">
      <header className="vx-nav">
        <div className="vx-wrap vx-nav-in">
          <button
            className="vx-brand"
            onClick={view === "workspace" ? reset : undefined}
          >
            <VertexMark size={26} />
            Vertex
          </button>
          <nav className="vx-nav-r">
            {view === "landing" ? (
              <>
                <a
                  className="vx-link"
                  href="#how"
                  aria-current={activeSec === "how" ? "true" : undefined}
                  onClick={scrollToId("how")}
                >
                  How it works
                </a>
                <a
                  className="vx-link"
                  href="#features"
                  aria-current={activeSec === "features" ? "true" : undefined}
                  onClick={scrollToId("features")}
                >
                  Features
                </a>
              </>
            ) : (
              <button className="vx-link vx-link-keep" onClick={reset}>
                Start over
              </button>
            )}
            <a
              className="vx-link vx-link-icon"
              href="https://github.com/AdemYahmadi/vertex"
              target="_blank"
              rel="noreferrer"
            >
              <GitHubIcon size={16} /> GitHub
            </a>
          </nav>
        </div>
      </header>

      {view === "landing" && (
        <main className="vx-main vx-wrap">
          <div className="vx-top" id="top">
            <section className="vx-hero">
              <p className="vx-kicker">Document scanner</p>
              <h1 className="vx-h1">
                Photos of paper in.{" "}
                <span className="vx-h1-accent">Scanner‑quality PDFs out.</span>
              </h1>
              <p className="vx-lead">
                Vertex finds the page in your photo, straightens it, evens out
                the lighting and exports a crisp PDF. It works on cluttered
                backgrounds and any paper size, and never keeps a copy of your
                files.
              </p>
              <a className="vx-more" href="#how" onClick={scrollToId("how")}>
                See how it works
                <ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
              </a>
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
                <DropArt />
                <p className="vx-drop-t">
                  {dragging ? "Drop to add" : "Drop photos to scan"}
                </p>
                <button
                  type="button"
                  className="vx-btn vx-btn-primary vx-btn-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  <UploadCloud size={18} strokeWidth={2} />
                  Choose photos
                </button>
                <p className="vx-drop-d">JPG or PNG · one or many</p>
              </div>
              {notice && (
                <p className="vx-notice" role="alert">
                  {notice}
                </p>
              )}
              {IS_HOSTED && (
                <aside className="vx-note">
                  <a
                    className="vx-note-link"
                    href="https://github.com/AdemYahmadi/vertex#cli"
                    target="_blank"
                    rel="noreferrer"
                  >
                    For best results, use the Vertex CLI
                    <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                  </a>
                  <ul className="vx-note-list">
                    <li>
                      <span className="vx-note-k">CLI</span>
                      Full resolution, most accurate model.
                    </li>
                    <li>
                      <span className="vx-note-k">Browser</span>
                      Lightweight model, images scaled to {HOSTED_MAX_SIDE}px.
                    </li>
                    <li>
                      <span className="vx-note-k">Tip</span>
                      Shoot pages on a plain background.
                    </li>
                  </ul>
                </aside>
              )}
            </section>
          </div>

          <section className="vx-sec" id="how">
            <h2 className="vx-sec-h">How it works</h2>
            <ol className="vx-steps">
              {HOW.map((s, i) => {
                const Icon = s.icon;
                return (
                  <li className="vx-step" key={s.t}>
                    <div className="vx-step-top">
                      <span className="vx-ic-tile">
                        <Icon size={20} strokeWidth={1.75} />
                      </span>
                      <span className="vx-step-n">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="vx-cell-h">{s.t}</h3>
                    <p className="vx-cell-d">{s.d}</p>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="vx-sec" id="features">
            <h2 className="vx-sec-h">Built for real-world documents</h2>
            <div className="vx-specs">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div className="vx-spec" key={f.t}>
                    <span className="vx-ic-tile">
                      <Icon size={20} strokeWidth={1.75} />
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
        <main className="vx-main vx-main-ws vx-wrap">
          <ol className="vx-stepper" aria-label="Progress">
            {["Upload", "Scan", "Download"].map((label, i) => {
              const state =
                i < stepIndex ? "done" : i === stepIndex ? "on" : "";
              const fill =
                i < stepIndex
                  ? 1
                  : i === stepIndex
                    ? phase === "processing"
                      ? progress
                      : 1
                    : 0;
              return (
                <li
                  key={label}
                  className={`vx-stepper-step ${state}`}
                  aria-current={i === stepIndex ? "step" : undefined}
                >
                  <span className="vx-stepper-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${fill})` }} />
                  </span>
                  <span className="vx-stepper-l">
                    <span className="vx-stepper-n" aria-hidden="true">
                      {i < stepIndex ? (
                        <Check size={13} strokeWidth={2.5} />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="vx-ws-bar">
            <h1 className="vx-ws-title">Pages</h1>
            <span className="vx-count">
              {items.length} {items.length === 1 ? "page" : "pages"}
              {items.length > 1 && (
                <span className="vx-ws-hint">
                  <span className="vx-hint-fine">Drag to reorder</span>
                  <span className="vx-hint-coarse">
                    Press and hold to reorder
                  </span>
                </span>
              )}
            </span>
          </div>

          {items.length > 1 && (
            <div
              ref={stripRef}
              className={`vx-strip ${drag ? (drag.dropped ? "is-dropping" : "is-dragging") : ""}`}
              role="group"
              aria-label="Pages"
            >
              {drag && (
                <span
                  className="vx-drop-mark"
                  aria-hidden="true"
                  style={{ transform: `translateX(${drag.to * drag.slot}px)` }}
                />
              )}
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
                      aria-label={`Page ${i + 1}${
                        it.state === "done"
                          ? ", scanned"
                          : it.state === "error"
                            ? ", failed"
                            : it.state === "processing"
                              ? ", scanning"
                              : ""
                      }`}
                      aria-describedby="vx-reorder-help"
                      title={`Page ${i + 1} · ← → to switch`}
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
                                  it.rotation % 180 ? " scale(1.334)" : ""
                                }`,
                              }
                            : undefined
                        }
                      />
                      {it.state === "processing" && (
                        <span className="vx-thumb-busy">
                          <Loader2
                            size={16}
                            className="vx-spin"
                            strokeWidth={2}
                          />
                        </span>
                      )}
                      <span className="vx-thumb-grip" aria-hidden="true">
                        <GripVertical size={14} strokeWidth={2} />
                      </span>
                      {it.state === "done" && (
                        <span className="vx-thumb-st ok" aria-hidden="true">
                          <Check size={11} strokeWidth={3} />
                        </span>
                      )}
                      {it.state === "error" && (
                        <span className="vx-thumb-st err" aria-hidden="true">
                          <TriangleAlert size={11} strokeWidth={2.5} />
                        </span>
                      )}
                      <span className="vx-thumb-n">{i + 1}</span>
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
              {(canRotate || !processing) && (
                <div
                  className="vx-doc-tools"
                  role="toolbar"
                  aria-label="Page tools"
                >
                  {canRotate && (
                    <button
                      className="vx-btn vx-btn-quiet vx-tip"
                      aria-label="Rotate page 90° clockwise"
                      aria-keyshortcuts="R"
                      data-tip="Rotate 90° clockwise · R"
                      onClick={() => rotatePage(selected.id)}
                    >
                      <RotateCwSquare size={16} strokeWidth={1.75} />
                      Rotate
                      <kbd className="vx-kbd" aria-hidden="true">
                        R
                      </kbd>
                    </button>
                  )}
                  {!processing && (
                    <button
                      className="vx-btn vx-btn-quiet vx-btn-danger vx-tip"
                      aria-label="Remove page"
                      aria-keyshortcuts="Delete Backspace"
                      data-tip="Remove page · Del"
                      onClick={() => removeItem(selected.id)}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                      Remove
                    </button>
                  )}
                </div>
              )}
            </header>

            <div className="vx-compare">
              <figure className="vx-pane">
                <figcaption className="vx-pane-label">
                  <span className="vx-pane-state">Original</span>
                </figcaption>
                <div className="vx-pane-surface">
                  <span className="vx-photo" style={originalBox}>
                    <img
                      src={selected.originalUrl}
                      alt="Original"
                      className="vx-doc vx-doc-photo"
                    />
                    {selected.state === "processing" && (
                      <span className="vx-scan" aria-hidden="true">
                        <span className="vx-scanline" />
                      </span>
                    )}
                  </span>
                </div>
              </figure>

              <figure className="vx-pane">
                <figcaption className="vx-pane-label">
                  <span className={`vx-pane-state is-${selected.state}`}>
                    {selected.state === "done"
                      ? "Result"
                      : selected.state === "processing"
                        ? "Scanning"
                        : selected.state === "error"
                          ? "Error"
                          : "Preview"}
                  </span>
                  {canRotate && selected.rotation !== 0 && (
                    <span className="vx-pane-rot">
                      Rotated {selected.rotation}°
                    </span>
                  )}
                </figcaption>
                <div className="vx-pane-surface" ref={surfaceRef}>
                  {selected.state === "done" && (
                    <img
                      key={selected.id}
                      src={selected.resultUrl}
                      alt="Scanned"
                      className="vx-doc vx-doc-sheet vx-doc-rot"
                      style={{
                        ...resultBox,
                        ...(angleOf(selected)
                          ? {
                              transform: `rotate(${angleOf(selected)}deg) scale(${resultScale})`,
                            }
                          : null),
                      }}
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
                      <div
                        className="vx-sheet vx-sheet-skel"
                        aria-hidden="true"
                      >
                        <span className="vx-skel-lines">
                          {Array.from({ length: 9 }, (_, k) => (
                            <span key={k} />
                          ))}
                        </span>
                      </div>
                      <p className="vx-state-d">
                        Straightening and cleaning up…
                      </p>
                    </div>
                  )}
                  {selected.state === "pending" && (
                    <div className="vx-state vx-state-msg">
                      <ScanLine
                        size={24}
                        strokeWidth={1.75}
                        className="vx-state-ic"
                      />
                      <p className="vx-state-t">Not scanned yet</p>
                      <p className="vx-state-d">
                        The cleaned page appears here after you scan.
                      </p>
                    </div>
                  )}
                  {selected.state === "error" && (
                    <div className="vx-state vx-state-msg" role="alert">
                      <AlertCircle
                        size={24}
                        strokeWidth={2}
                        className="vx-state-ic err"
                      />
                      <p className="vx-state-t">Couldn't scan this page</p>
                      <p className="vx-state-d">{selected.error}</p>
                    </div>
                  )}
                </div>
              </figure>
            </div>
          </section>

          {notice && (
            <p className="vx-notice" role="alert">
              {notice}
            </p>
          )}

          <div
            className={`vx-ws-actions ${phase === "processing" ? "is-busy" : ""}`}
          >
            <div className="vx-ws-meta">
              <span className="vx-ws-status" aria-live="polite">
                {phase === "processing" ? (
                  <>
                    <Loader2 size={16} className="vx-spin" strokeWidth={2} />
                    Scanning page {Math.min(
                      doneCount + 1,
                      items.length,
                    )} of {items.length}…
                  </>
                ) : phase === "done" ? (
                  doneCount > 0 ? (
                    `${doneCount} ${doneCount === 1 ? "page" : "pages"} scanned`
                  ) : (
                    "Nothing scanned yet"
                  )
                ) : (
                  `${pendingCount} ${pendingCount === 1 ? "page" : "pages"} ready to scan`
                )}
              </span>
              {phase === "processing" && (
                <span className="vx-progress" aria-hidden="true">
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
              )}
              {phase === "done" && doneCount > 0 && errorCount > 0 && (
                <span className="vx-ws-note">
                  {errorCount} {errorCount === 1 ? "page" : "pages"} failed and
                  will be left out.
                </span>
              )}
            </div>

            {phase !== "processing" && (
              <div className="vx-ws-tools">
                <button
                  className="vx-btn vx-btn-secondary"
                  onClick={() => inputRef.current?.click()}
                >
                  <Plus size={16} strokeWidth={2} />
                  Add pages
                </button>
                {phase === "done" && doneCount > 0 && (
                  <button
                    className="vx-btn vx-btn-secondary"
                    onClick={rescanAll}
                  >
                    <RefreshCw size={16} strokeWidth={1.75} />
                    Scan again
                  </button>
                )}
              </div>
            )}

            {phase !== "processing" && (
              <div className="vx-ws-export">
                {phase === "ready" && (
                  <button className="vx-btn vx-btn-primary" onClick={scanAll}>
                    <ScanLine size={16} strokeWidth={2} />
                    Scan {pendingCount > 1 ? `${pendingCount} pages` : "page"}
                  </button>
                )}
                {phase === "done" && doneCount === 0 && (
                  <button className="vx-btn vx-btn-primary" onClick={rescanAll}>
                    <RefreshCw size={16} strokeWidth={2} />
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
                    className="vx-btn vx-btn-primary"
                    onClick={exportSeparate ? downloadSeparate : downloadAll}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <Loader2 size={16} className="vx-spin" strokeWidth={2} />
                    ) : (
                      <Download size={16} strokeWidth={2} />
                    )}
                    <span>
                      {downloading
                        ? "Preparing…"
                        : exportSeparate
                          ? "Download ZIP"
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
        <div className="vx-wrap vx-footer-in">
          <p className="vx-copy">
            © {year} Vertex · Made for cleaner documents
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
