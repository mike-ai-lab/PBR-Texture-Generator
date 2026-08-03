"""
Misc helpers shared across the project.
"""
import os
from PIL import Image
import customtkinter as ctk


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tga", ".webp"}


def is_supported_image(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in SUPPORTED_EXTENSIONS


def pil_image_for_preview(path: str, max_size: int = 256) -> Image.Image:
    """Load an image and fit it inside a square of *max_size* px."""
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    return img


def resource_path(relative: str) -> str:
    """Resolve a path relative to the project root (works from launcher or frozen exe)."""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.normpath(os.path.join(base, relative))
