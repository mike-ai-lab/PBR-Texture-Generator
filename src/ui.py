"""
PBR Texture Generator — main window.

Layout (resizable):
  ┌─ Header bar ────────────────────────────────────────────────┐
  ├─ Body ──────────────────────────────────────────────────────┤
  │  Left sidebar (fixed 280 px)  │  Right content (fills rest) │
  │  · Drop zone                  │  · Output map grid           │
  │  · File name                  │                              │
  │  · Sliders section            │                              │
  │  · Generate button            │                              │
  ├─ Status bar ────────────────────────────────────────────────┤
  └─────────────────────────────────────────────────────────────┘
"""
import os
import threading
import tkinter as tk
from tkinter import filedialog, messagebox
import shutil

import customtkinter as ctk
from PIL import Image

from src.image_processing import process_texture
from src.utils import is_supported_image, pil_image_for_preview, resource_path
from src.previewer import launch_preview

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

OUTPUT_DIR = resource_path("output")

MAP_SLOTS = [
    ("albedo",    "Albedo"),
    ("normal",    "Normal"),
    ("roughness", "Roughness"),
    ("ao",        "Ambient Occlusion"),
]

# Colours
C_BG        = "#1c1c1e"
C_SIDEBAR   = "#2a2a2e"
C_CARD      = "#323236"
C_ACCENT    = "#4f8ef7"
C_TEXT      = "#f0f0f0"
C_SUBTEXT   = "#888"
C_DROP_IDLE = "#28282c"
C_STATUS_OK = "#4caf7d"
C_STATUS_ERR= "#e05555"


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("PBR Texture Generator")
        self.geometry("1100x700")
        self.minsize(900, 600)
        self.resizable(True, True)
        self.configure(fg_color=C_BG)

        self._input_path: str | None = None
        self._result_paths: dict[str, str] = {}
        self._ctk_images: dict[str, ctk.CTkImage] = {}

        self._build_ui()
        self._enable_drop()

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------
    def _build_ui(self):
        self.grid_rowconfigure(1, weight=1)
        self.grid_columnconfigure(1, weight=1)

        self._build_header()
        self._build_sidebar()
        self._build_content()
        self._build_statusbar()

    # --- Header -------------------------------------------------------
    def _build_header(self):
        hdr = ctk.CTkFrame(self, height=52, fg_color="#111113", corner_radius=0)
        hdr.grid(row=0, column=0, columnspan=2, sticky="ew")
        hdr.grid_propagate(False)

        ctk.CTkLabel(
            hdr, text="⬡  PBR Texture Generator",
            font=("Segoe UI", 15, "bold"), text_color=C_TEXT
        ).pack(side="left", padx=20)

        ctk.CTkLabel(
            hdr, text="v1.0",
            font=("Segoe UI", 11), text_color=C_SUBTEXT
        ).pack(side="left")

        ctk.CTkButton(
            hdr, text="Open Output Folder", width=150, height=30,
            fg_color="transparent", border_width=1, border_color="#444",
            text_color=C_TEXT, hover_color="#333",
            command=self._open_output_folder
        ).pack(side="right", padx=16)

    # --- Sidebar ------------------------------------------------------
    def _build_sidebar(self):
        sb = ctk.CTkFrame(self, width=272, fg_color=C_SIDEBAR, corner_radius=0)
        sb.grid(row=1, column=0, sticky="ns", padx=0, pady=0)
        sb.grid_propagate(False)
        sb.grid_rowconfigure(3, weight=1)

        # Drop zone
        drop_card = ctk.CTkFrame(sb, fg_color=C_DROP_IDLE, corner_radius=14,
                                  border_width=2, border_color="#3a3a3e")
        drop_card.grid(row=0, column=0, padx=16, pady=(20, 8), sticky="ew")
        sb.grid_columnconfigure(0, weight=1)

        self._drop_label = ctk.CTkLabel(
            drop_card,
            text="↑\n\nDrag & drop texture\nor click to browse",
            font=("Segoe UI", 12), text_color=C_SUBTEXT,
            height=180, cursor="hand2",
        )
        self._drop_label.pack(fill="both", expand=True, padx=4, pady=4)
        self._drop_label.bind("<Button-1>", lambda _: self._open_file_dialog())
        drop_card.bind("<Button-1>", lambda _: self._open_file_dialog())

        self._input_name = ctk.CTkLabel(
            sb, text="No file loaded",
            font=("Segoe UI", 10), text_color=C_SUBTEXT, wraplength=240
        )
        self._input_name.grid(row=1, column=0, padx=16, pady=(0, 12), sticky="ew")

        # Settings card
        settings_card = ctk.CTkFrame(sb, fg_color=C_CARD, corner_radius=12)
        settings_card.grid(row=2, column=0, padx=16, pady=(0, 12), sticky="ew")

        ctk.CTkLabel(
            settings_card, text="SETTINGS",
            font=("Segoe UI", 10, "bold"), text_color=C_SUBTEXT
        ).pack(anchor="w", padx=14, pady=(12, 6))

        self._normal_strength = self._add_slider(settings_card, "Normal Strength",  1,   30,  10)
        self._roughness_alpha = self._add_slider(settings_card, "Roughness Alpha",  0.1, 2.0, 0.8, step=0.05)
        self._roughness_beta  = self._add_slider(settings_card, "Roughness Offset", -100,100, 50)
        self._ao_alpha        = self._add_slider(settings_card, "AO Intensity",     0.5, 3.0, 1.5, step=0.1)

        ctk.CTkFrame(settings_card, height=1, fg_color="#3a3a3e").pack(fill="x", padx=14, pady=8)

        # Generate button + Preview button (side by side)
        btn_row = ctk.CTkFrame(sb, fg_color="transparent")
        btn_row.grid(row=3, column=0, padx=16, pady=(0, 20), sticky="sew")
        btn_row.grid_columnconfigure(0, weight=3)
        btn_row.grid_columnconfigure(1, weight=2)
        sb.grid_rowconfigure(3, weight=1)

        self._generate_btn = ctk.CTkButton(
            btn_row,
            text="Generate Maps",
            height=44,
            font=("Segoe UI", 13, "bold"),
            fg_color=C_ACCENT,
            hover_color="#3a70d4",
            corner_radius=10,
            command=self._on_generate,
            state="disabled",
        )
        self._generate_btn.grid(row=0, column=0, sticky="ew", padx=(0, 6))

        self._preview_btn = ctk.CTkButton(
            btn_row,
            text="3D View",
            height=44,
            font=("Segoe UI", 12, "bold"),
            fg_color="#2a2a2e",
            hover_color="#383844",
            border_width=1,
            border_color="#444",
            corner_radius=10,
            command=self._on_preview_3d,
            state="disabled",
        )
        self._preview_btn.grid(row=0, column=1, sticky="ew")

    def _add_slider(self, parent, label, from_, to, default, step=1.0):
        frame = ctk.CTkFrame(parent, fg_color="transparent")
        frame.pack(fill="x", padx=14, pady=(2, 6))

        top = ctk.CTkFrame(frame, fg_color="transparent")
        top.pack(fill="x")
        ctk.CTkLabel(top, text=label, font=("Segoe UI", 11), text_color=C_TEXT).pack(side="left")

        val_var = tk.StringVar(value=str(default))
        ctk.CTkLabel(top, textvariable=val_var, font=("Segoe UI", 11, "bold"),
                     text_color=C_ACCENT, width=44, anchor="e").pack(side="right")

        dbl_var = tk.DoubleVar(value=default)

        def _update(v):
            r = round(float(v), 2)
            dbl_var.set(r)
            val_var.set(str(r))

        ctk.CTkSlider(
            frame, from_=from_, to=to, variable=dbl_var,
            command=_update, height=14,
            button_color=C_ACCENT, button_hover_color="#3a70d4",
            progress_color=C_ACCENT,
        ).pack(fill="x", pady=(2, 0))

        return dbl_var

    # --- Content area -------------------------------------------------
    def _build_content(self):
        content = ctk.CTkFrame(self, fg_color=C_BG, corner_radius=0)
        content.grid(row=1, column=1, sticky="nsew", padx=0, pady=0)
        content.grid_rowconfigure(1, weight=1)
        content.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            content, text="Output Maps",
            font=("Segoe UI", 13, "bold"), text_color=C_TEXT
        ).grid(row=0, column=0, sticky="w", padx=24, pady=(20, 8))

        # Scrollable grid of map previews
        self._preview_frame = ctk.CTkScrollableFrame(
            content, fg_color="transparent", corner_radius=0
        )
        self._preview_frame.grid(row=1, column=0, sticky="nsew", padx=16, pady=(0, 8))
        self._preview_frame.grid_columnconfigure((0, 1, 2, 3), weight=1)

        self._preview_widgets: dict[str, ctk.CTkLabel] = {}
        self._preview_size_ref: list[int] = [220]  # mutable ref for resize

        for col_idx, (key, label) in enumerate(MAP_SLOTS):
            card = ctk.CTkFrame(self._preview_frame, fg_color=C_CARD, corner_radius=12)
            card.grid(row=0, column=col_idx, padx=8, pady=8, sticky="nsew")

            ctk.CTkLabel(
                card, text=label,
                font=("Segoe UI", 11, "bold"), text_color=C_TEXT
            ).pack(anchor="w", padx=14, pady=(12, 4))

            img_lbl = ctk.CTkLabel(
                card, text="—",
                font=("Segoe UI", 22), text_color="#444",
                width=200, height=200,
                fg_color="#222224", corner_radius=8
            )
            img_lbl.pack(padx=12, pady=(0, 8))
            img_lbl.bind("<Button-1>", lambda _, k=key: self._save_map(k))

            save_btn = ctk.CTkButton(
                card, text="Save", height=28,
                fg_color="transparent", border_width=1, border_color="#444",
                text_color=C_SUBTEXT, hover_color="#3a3a3e",
                font=("Segoe UI", 10),
                command=lambda k=key: self._save_map(k)
            )
            save_btn.pack(padx=12, pady=(0, 12), fill="x")

            self._preview_widgets[key] = img_lbl

        # Bind resize to update previews
        self._preview_frame.bind("<Configure>", self._on_resize)

    # --- Status bar ---------------------------------------------------
    def _build_statusbar(self):
        bar = ctk.CTkFrame(self, height=32, fg_color="#111113", corner_radius=0)
        bar.grid(row=2, column=0, columnspan=2, sticky="ew")
        bar.grid_propagate(False)

        self._status_dot = ctk.CTkLabel(bar, text="●", font=("Segoe UI", 10), text_color="#555")
        self._status_dot.pack(side="left", padx=(12, 4))

        self._status = ctk.CTkLabel(bar, text="Ready", font=("Segoe UI", 10), text_color=C_SUBTEXT)
        self._status.pack(side="left")

    # ------------------------------------------------------------------
    # Drag-and-drop
    # ------------------------------------------------------------------
    def _enable_drop(self):
        try:
            self.drop_target_register("*")          # type: ignore[attr-defined]
            self.dnd_bind("<<Drop>>", self._on_drop) # type: ignore[attr-defined]
        except Exception:
            pass

    def _on_drop(self, event):
        self._load_image(event.data.strip().strip("{}"))

    # ------------------------------------------------------------------
    # File handling
    # ------------------------------------------------------------------
    def _open_file_dialog(self):
        path = filedialog.askopenfilename(
            title="Select texture",
            filetypes=[("Images", "*.png *.jpg *.jpeg *.bmp *.tiff *.tga *.webp"), ("All files", "*.*")],
        )
        if path:
            self._load_image(path)

    def _load_image(self, path: str):
        if not is_supported_image(path):
            messagebox.showerror("Unsupported", f"Not a supported image:\n{path}")
            return
        self._input_path = path
        self._input_name.configure(text=os.path.basename(path), text_color=C_TEXT)

        pil = pil_image_for_preview(path, 200)
        ctk_img = ctk.CTkImage(light_image=pil, dark_image=pil, size=(200, 200))
        self._ctk_images["_drop"] = ctk_img
        self._drop_label.configure(image=ctk_img, text="")

        self._generate_btn.configure(state="normal")
        self._preview_btn.configure(state="disabled")
        self._set_status("Image loaded — adjust settings and click Generate", C_SUBTEXT)

        for key, lbl in self._preview_widgets.items():
            self._ctk_images.pop(key, None)
            lbl.configure(image="", text="—")
        self._result_paths = {}

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------
    def _on_generate(self):
        if not self._input_path:
            return
        self._generate_btn.configure(state="disabled", text="Generating…")
        self._set_status("Working…", C_SUBTEXT)
        threading.Thread(target=self._run_generation, daemon=True).start()

    def _run_generation(self):
        try:
            results = process_texture(
                self._input_path, OUTPUT_DIR,
                normal_strength=self._normal_strength.get(),
                roughness_alpha=self._roughness_alpha.get(),
                roughness_beta=self._roughness_beta.get(),
                ao_alpha=self._ao_alpha.get(),
            )
            self.after(0, self._on_done, results)
        except Exception as exc:
            self.after(0, self._on_generation_error, str(exc))

    def _on_done(self, results: dict[str, str]):
        self._result_paths = results
        sz = self._current_preview_size()

        for key, lbl in self._preview_widgets.items():
            path = results.get(key)
            if not path:
                continue
            pil = pil_image_for_preview(path, sz)
            ctk_img = ctk.CTkImage(light_image=pil, dark_image=pil, size=(sz, sz))
            self._ctk_images[key] = ctk_img
            lbl.configure(image=ctk_img, text="", width=sz, height=sz)

        mat = os.path.basename(os.path.dirname(next(iter(results.values()))))
        self._generate_btn.configure(state="normal", text="Generate Maps")
        self._preview_btn.configure(state="normal")
        self._set_status(f"Done — saved to output/{mat}/", C_STATUS_OK)

    def _on_generation_error(self, msg: str):
        self._generate_btn.configure(state="normal", text="Generate Maps")
        self._set_status(f"Error: {msg}", C_STATUS_ERR)
        messagebox.showerror("Generation failed", msg)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _set_status(self, text: str, color: str):
        self._status.configure(text=text, text_color=color)
        dot_color = C_STATUS_OK if color == C_STATUS_OK else (C_STATUS_ERR if color == C_STATUS_ERR else "#555")
        self._status_dot.configure(text_color=dot_color)

    def _current_preview_size(self) -> int:
        w = self._preview_frame.winfo_width()
        sz = max(120, (w // 4) - 48)
        return min(sz, 320)

    def _on_resize(self, _event=None):
        if not self._result_paths:
            return
        sz = self._current_preview_size()
        for key, lbl in self._preview_widgets.items():
            path = self._result_paths.get(key)
            if not path:
                continue
            pil = pil_image_for_preview(path, sz)
            ctk_img = ctk.CTkImage(light_image=pil, dark_image=pil, size=(sz, sz))
            self._ctk_images[key] = ctk_img
            lbl.configure(image=ctk_img, width=sz, height=sz)

    def _on_preview_3d(self):
        if self._result_paths:
            mat_name = os.path.basename(os.path.dirname(next(iter(self._result_paths.values()))))
            launch_preview(self._result_paths, mat_name)

    def _open_output_folder(self):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.startfile(OUTPUT_DIR)

    def _save_map(self, key: str):
        src = self._result_paths.get(key)
        if not src:
            return
        dest = filedialog.asksaveasfilename(
            defaultextension=".png",
            initialfile=os.path.basename(src),
            filetypes=[("PNG", "*.png"), ("JPEG", "*.jpg"), ("All files", "*.*")],
        )
        if dest:
            shutil.copy2(src, dest)
