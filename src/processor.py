from typing import Optional

import numpy as np

from src.core.enhancement import enhance_document
from src.core.geometry import get_document_contours, order_points, warp_perspective


class DocumentProcessor:
    def detect(self, image: np.ndarray) -> Optional[np.ndarray]:
        corners = get_document_contours(image)
        return None if corners is None else order_points(corners)

    def run(
        self,
        image: np.ndarray,
        corners: Optional[np.ndarray] = None,
        trim: bool = True,
    ) -> np.ndarray:
        if corners is None:
            corners = get_document_contours(image)
            if corners is None:
                raise ValueError("Failed to detect document boundary.")
            warped = warp_perspective(image, corners)
        else:
            warped = warp_perspective(image, corners, ordered=True)
        return enhance_document(warped, trim=trim)
