import gc
import logging
import os
from contextlib import asynccontextmanager

import cv2
import img2pdf
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from src.processor import DocumentProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vertex")

cv2.setNumThreads(1)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "15"))
MAX_UPLOAD_BYTES = int(MAX_UPLOAD_MB * 1024 * 1024)
MAX_IMAGE_SIDE = int(os.getenv("MAX_IMAGE_SIDE", "0"))
ALLOWED_TYPES = {"image/jpeg", "image/png"}

processor: DocumentProcessor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global processor
    logger.info("Loading document processor...")
    processor = DocumentProcessor()
    try:
        dummy = np.full((64, 64, 3), 255, dtype=np.uint8)
        try:
            processor.run(dummy)
        except ValueError:
            pass
        logger.info("Model warm-up complete.")
    except Exception as e:
        logger.warning("Warm-up skipped: %s", e)
    yield


app = FastAPI(
    title="Vertex API",
    description="Turn photos of documents into clean, scanner-quality PDFs.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    ready = processor is not None
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ok" if ready else "loading", "model_ready": ready},
    )


@app.post("/scan")
async def scan(
    file: UploadFile = File(...),
    fmt: str = Query("pdf", pattern="^(pdf|png)$"),
):
    if processor is None:
        raise HTTPException(503, "Service is still starting up. Try again shortly.")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Unsupported file type. Upload a JPG or PNG image.")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Image too large. Limit is {MAX_UPLOAD_MB:.0f} MB.")

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    del data

    if img is None:
        raise HTTPException(400, "Could not decode that image.")

    h, w = img.shape[:2]
    if MAX_IMAGE_SIDE and max(h, w) > MAX_IMAGE_SIDE:
        scale = MAX_IMAGE_SIDE / max(h, w)
        img = cv2.resize(
            img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
        )

    try:
        result = processor.run(img)
        del img
    except ValueError:
        raise HTTPException(
            422,
            "No document detected. Try a photo with the whole page visible "
            "against a contrasting background.",
        )
    except Exception:
        logger.exception("Pipeline error")
        raise HTTPException(500, "Processing failed. Please try again.")

    ok, buf = cv2.imencode(".png" if fmt == "png" else ".jpg", result)
    if not ok:
        raise HTTPException(500, "Failed to encode the result.")

    base = os.path.splitext(file.filename or "scan")[0]

    if fmt == "png":
        gc.collect()
        return Response(
            content=buf.tobytes(),
            media_type="image/png",
            headers={"Content-Disposition": f'inline; filename="{base}.png"'},
        )

    pdf_bytes = img2pdf.convert(buf.tobytes())
    gc.collect()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{base}.pdf"'},
    )


@app.get("/")
def root():
    return {"service": "vertex", "docs": "/docs", "health": "/health"}