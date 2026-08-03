"""
make_seamless(img) — converts a non-tileable BGR/grayscale image into a seamless tile.

Pipeline
--------
1. Downsample to 512px working size
2. Roll seam to centre
3. Laplacian pyramid blend with raised-cosine mask (4 levels)
4. Roll back
5. Upsample back to original resolution

No inpainting — inpaint creates blurred border strips that cause
downstream artifacts in normal/AO map generation.
"""
import cv2
import numpy as np


def _cosine_mask(h: int, w: int, blend_px: int) -> np.ndarray:
    """
    Float32 mask [0..1] shape (h,w).
    1 in the interior, smoothly fades to 0 at each border over blend_px pixels.
    Uses a raised-cosine (Hann) ramp for C1-continuous transitions.
    """
    def ramp(size: int, px: int) -> np.ndarray:
        r = np.ones(size, dtype=np.float32)
        t = np.linspace(0.0, np.pi, px, endpoint=False)
        fade = (1.0 - np.cos(t)) * 0.5   # 0 → 1
        r[:px]  = fade
        r[-px:] = fade[::-1]
        return r

    return np.outer(ramp(h, blend_px), ramp(w, blend_px))


def _build_gaussian_pyramid(img: np.ndarray, levels: int):
    gp = [img.astype(np.float32)]
    for _ in range(levels - 1):
        gp.append(cv2.pyrDown(gp[-1]))
    return gp


def _pyramid_blend(a: np.ndarray, b: np.ndarray,
                   mask: np.ndarray, levels: int = 4) -> np.ndarray:
    """
    Multi-scale Laplacian pyramid blend.
    mask: float32 (h,w) in [0..1] — 1 keeps a, 0 keeps b.
    """
    mask3 = mask[:, :, np.newaxis] if a.ndim == 3 else mask

    gp_a = _build_gaussian_pyramid(a,     levels)
    gp_b = _build_gaussian_pyramid(b,     levels)
    gp_m = _build_gaussian_pyramid(mask3, levels)

    lp_a, lp_b = [], []
    for i in range(levels - 1):
        up_a = cv2.pyrUp(gp_a[i+1], dstsize=(gp_a[i].shape[1], gp_a[i].shape[0]))
        up_b = cv2.pyrUp(gp_b[i+1], dstsize=(gp_b[i].shape[1], gp_b[i].shape[0]))
        lp_a.append(gp_a[i] - up_a)
        lp_b.append(gp_b[i] - up_b)
    lp_a.append(gp_a[-1])
    lp_b.append(gp_b[-1])

    blended = []
    for la, lb, gm in zip(lp_a, lp_b, gp_m):
        if gm.ndim == 2 and la.ndim == 3:
            gm = gm[:, :, np.newaxis]
        blended.append(la * gm + lb * (1.0 - gm))

    result = blended[-1]
    for i in range(levels - 2, -1, -1):
        result = cv2.pyrUp(result, dstsize=(blended[i].shape[1], blended[i].shape[0]))
        result = result + blended[i]

    return np.clip(result, 0, 255).astype(np.uint8)


def make_seamless(img: np.ndarray, blend_ratio: float = 0.25) -> np.ndarray:
    """
    Convert a BGR (or grayscale) image into a seamless tileable texture.

    Works at max 512px internally then upsamples back to preserve memory.
    No inpainting — uses pure pyramid blending for clean results.
    """
    WORK_MAX   = 512
    orig_h, orig_w = img.shape[:2]

    # ── Downsample ────────────────────────────────────────────────────
    scale = min(1.0, WORK_MAX / max(orig_h, orig_w))
    if scale < 1.0:
        ww = max(4, int(orig_w * scale))
        wh = max(4, int(orig_h * scale))
        work = cv2.resize(img, (ww, wh), interpolation=cv2.INTER_AREA)
    else:
        work = img.copy()

    h, w = work.shape[:2]
    # Use a generous blend zone — wider = smoother seam, no hard edge
    blend_px = max(16, int(min(h, w) * max(blend_ratio, 0.30)))

    # ── Roll seam to centre ───────────────────────────────────────────
    shifted = np.roll(work, shift=(h // 2, w // 2), axis=(0, 1))

    # ── Pyramid blend ─────────────────────────────────────────────────
    # mask = 1 in centre (keep shifted), 0 at edges (keep work)
    mask    = _cosine_mask(h, w, blend_px)
    blended = _pyramid_blend(shifted, work, mask)
    del shifted

    # ── Roll back ─────────────────────────────────────────────────────
    result = np.roll(blended, shift=(-h // 2, -w // 2), axis=(0, 1))
    del blended

    # ── Upsample back to original resolution ─────────────────────────
    if scale < 1.0:
        result = cv2.resize(result, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)

    return result.astype(np.uint8)
