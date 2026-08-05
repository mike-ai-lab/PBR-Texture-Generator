"""
PBR map generation functions.
Each function takes a grayscale (or BGR) numpy array and returns a map array.

All filters use BORDER_WRAP padding so the kernels see a seamless tiled
continuation at every edge — eliminates the bright-border artifact in tiled normal maps.
"""
import cv2
import numpy as np


def _wrap_pad(img: np.ndarray, pad: int) -> np.ndarray:
    """
    Tile-wrap pad an image on all four sides.
    cv2.copyMakeBorder does not support BORDER_WRAP directly on all builds,
    so we do it manually with numpy roll slicing.
    """
    # vertical wrap
    img = np.concatenate([img[-pad:], img, img[:pad]], axis=0)
    # horizontal wrap
    img = np.concatenate([img[:, -pad:], img, img[:, :pad]], axis=1)
    return img


def generate_normal(gray: np.ndarray, strength: float = 10.0) -> np.ndarray:
    """Sobel-based normal map with wrap-padded edges. Returns BGR uint8."""
    gray  = gray.astype(np.float32)
    pad   = 4
    padded = _wrap_pad(gray, pad)

    gx = cv2.Sobel(padded, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(padded, cv2.CV_32F, 0, 1, ksize=3)

    # Crop padding back out
    gx = gx[pad:-pad, pad:-pad]
    gy = gy[pad:-pad, pad:-pad]

    gz     = np.full(gray.shape, strength, dtype=np.float32)
    normal = np.dstack((-gx, gy, gz))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True) + 1e-8
    normal  = ((normal + 1) / 2 * 255).astype(np.uint8)
    return cv2.cvtColor(normal, cv2.COLOR_RGB2BGR)


def generate_roughness(gray: np.ndarray, alpha: float = 0.8, beta: float = 50) -> np.ndarray:
    """Inverted + blurred roughness map with wrap-padded edges. Returns grayscale uint8."""
    pad  = 8
    inv  = cv2.bitwise_not(gray)
    padded  = _wrap_pad(inv, pad)
    blurred = cv2.GaussianBlur(padded, (3, 3), 0)
    blurred = blurred[pad:-pad, pad:-pad]
    return cv2.convertScaleAbs(blurred, alpha=alpha, beta=beta)


def generate_ao(gray: np.ndarray, alpha: float = 1.5, beta: float = -30) -> np.ndarray:
    """Simple AO approximation with wrap-padded edges. Returns grayscale uint8."""
    pad = 32
    inv    = cv2.bitwise_not(gray)
    padded = _wrap_pad(inv, pad)
    blur   = cv2.GaussianBlur(padded, (21, 21), 0)
    blur   = blur[pad:-pad, pad:-pad]
    ao = (gray.astype(float) / 255.0) * (cv2.bitwise_not(blur).astype(float) / 255.0) * 255.0
    return cv2.convertScaleAbs(ao, alpha=alpha, beta=beta)


def generate_height(gray: np.ndarray, scale: float = 1.0) -> np.ndarray:
    """
    Height map — luminance-based with light blur for smoother depth transitions.
    Bright = high, dark = low. Returns grayscale uint8.
    """
    pad     = 4
    padded  = _wrap_pad(gray, pad)
    blurred = cv2.GaussianBlur(padded, (3, 3), 0)
    blurred = blurred[pad:-pad, pad:-pad]
    return cv2.convertScaleAbs(blurred, alpha=scale)


def generate_metalness(
    gray: np.ndarray,
    threshold: float = 0.6,
    contrast: float = 4.0,
) -> np.ndarray:
    """
    Metalness map — sigmoid-like curve around a luminance threshold.
    Bright highlights above threshold → metallic (white).
    Returns grayscale uint8.
    """
    g   = gray.astype(np.float32) / 255.0
    raw = (g - threshold) * contrast + 0.5
    v   = np.clip(raw * 255.0, 0, 255).astype(np.uint8)
    return v


def generate_emissive(bgr: np.ndarray, threshold: float = 0.8, intensity: float = 2.0) -> np.ndarray:
    """
    Emissive map — extract bright regions above threshold as a coloured glow.
    Returns BGR uint8.
    """
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    denom  = max(1.0 - threshold, 1e-4)
    factor = np.clip((lum - threshold) / denom * intensity, 0.0, None)
    factor = factor[:, :, np.newaxis]
    out    = np.clip(rgb * factor * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
