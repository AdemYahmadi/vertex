import os

import cv2
import numpy as np
from docaligner import DocAligner

_MODEL = DocAligner(model_cfg=os.getenv("DOCALIGNER_MODEL", "fastvit_sa24"))


def get_document_contours(image: np.ndarray) -> np.ndarray:
    if image is None or image.size == 0:
        return None
    polygon = _MODEL(image)
    if polygon is None or len(polygon) != 4:
        return None
    corners = np.asarray(polygon, dtype="float32")
    if cv2.contourArea(corners) < 1.0:
        return None
    return corners


def order_points(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2)
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def is_valid_quad(points: np.ndarray, width: int, height: int) -> bool:
    """Check that TL, TR, BR, BL points form a convex, non-degenerate quad."""
    pts = np.asarray(points, dtype="float64").reshape(-1, 2)
    if pts.shape != (4, 2) or not np.all(np.isfinite(pts)):
        return False
    if np.any(pts < -0.5) or np.any(pts[:, 0] > width + 0.5) or np.any(pts[:, 1] > height + 0.5):
        return False
    for i in range(4):
        a, b, c = pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if cross <= 0:
            return False
    min_side = 0.02 * max(width, height)
    if any(np.linalg.norm(pts[i] - pts[(i + 1) % 4]) < min_side for i in range(4)):
        return False
    return cv2.contourArea(pts.astype("float32")) >= 0.005 * width * height


def warp_perspective(
    image: np.ndarray, points: np.ndarray, ordered: bool = False
) -> np.ndarray:
    rect = (
        np.asarray(points, dtype="float32").reshape(4, 2)
        if ordered
        else order_points(points)
    )
    tl, tr, br, bl = rect
    width_a = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    width_b = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    max_width = max(int(width_a), int(width_b))
    height_a = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    height_b = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    max_height = max(int(height_a), int(height_b))
    dst = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (max_width, max_height))
