"""
Image I/O and orchestration — loads input, calls generators, saves outputs.
Each run creates output_dir/<material_name>/ and writes every map (+ albedo) there.
"""
import cv2
import os
import shutil
import numpy as np
from PIL import Image as PILImage
from src.generators import generate_normal, generate_roughness, generate_ao
from src.seamless import make_seamless


def _imread_safe(path: str) -> np.ndarray:
    """
    cv2.imread fails silently on Windows paths with spaces/unicode.
    Fall back to PIL -> numpy so any valid image format loads correctly.
    """
    # Normalize slashes and resolve the full path
    path = os.path.normpath(os.path.abspath(path))
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Image file not found: {path}")

    # Try cv2 first (fastest)
    img = cv2.imread(path)
    if img is not None:
        return img

    # Fallback: PIL handles spaces, unicode, and more formats
    pil = PILImage.open(path).convert("RGB")
    arr = np.array(pil)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def process_texture(
    input_path: str,
    output_base_dir: str,
    normal_strength: float = 10.0,
    roughness_alpha: float = 0.8,
    roughness_beta: float = 50.0,
    ao_alpha: float = 1.5,
    ao_beta: float = -30.0,
    make_seamless_flag: bool = False,
    seamless_blend: float = 0.25,
) -> dict[str, str]:
    """
    Generate all PBR maps for *input_path*.
    Creates output_base_dir/<base_name>/ and writes every map (+ albedo) there.
    Returns a dict mapping map-type keys to output file paths.
    """
    input_path = os.path.normpath(os.path.abspath(input_path))
    output_base_dir = os.path.normpath(os.path.abspath(output_base_dir))

    base = os.path.splitext(os.path.basename(input_path))[0]
    mat_dir = os.path.join(output_base_dir, base)
    os.makedirs(mat_dir, exist_ok=True)

    bgr = _imread_safe(input_path)

    # Apply seamless conversion to albedo before deriving maps
    if make_seamless_flag:
        bgr = make_seamless(bgr, blend_ratio=seamless_blend)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # Save albedo (seamless version if applicable)
    albedo_dest = os.path.normpath(os.path.join(mat_dir, f"{base}_alb.png"))
    cv2.imwrite(albedo_dest, bgr)

    outputs = {"albedo": albedo_dest}

    maps = {
        "normal":    (generate_normal(gray, normal_strength),                    f"{base}_nrm.png"),
        "roughness": (generate_roughness(gray, roughness_alpha, roughness_beta), f"{base}_rgh.png"),
        "ao":        (generate_ao(gray, ao_alpha, ao_beta),                      f"{base}_ao.png"),
    }

    for key, (img, filename) in maps.items():
        path = os.path.normpath(os.path.join(mat_dir, filename))
        cv2.imwrite(path, img)
        outputs[key] = path

    return outputs
