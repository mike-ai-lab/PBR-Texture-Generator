# PBR Texture Generator

A browser-based tool that generates PBR maps from a single albedo texture and previews them live on a 3D surface.

## Quick start

```bash
pip install -r requirements.txt
python server.py
```

The server starts on `http://localhost:5199` and opens the browser automatically.
Double-click `Run PBR Generator.bat` for the same thing without a terminal.

## Desktop shortcut

Run once to place a shortcut on your Desktop:

```bash
python create_shortcut.py
```

## Workflow

1. Drag & drop an albedo texture into the left panel (or click to browse)
2. Adjust generation settings — Normal Strength, Roughness Alpha/Offset, AO Intensity
3. Click **Generate Maps**
4. Preview the result live in the 3D viewport or switch to **2D** to inspect each map

## 3D Preview

The toolbar in the top-right of the viewport controls the preview:

| Control | Options |
|---|---|
| View mode | 3D / 2D |
| Shape | Plane, Sphere, Cube, Cylinder |
| Lighting | Manual Light / HDRI |
| HDRI preset | Studio, Venice Sunset, Forest, Industrial Sky, Overcast |

**Manual Light** — directional + rim light. Use the sidebar sliders to control intensity and rotation.  
**HDRI** — environment-based ambient lighting. Directional lights are disabled. Switch presets to change the mood.

Material sliders (Tiling, Normal Scale, AO Intensity) work in both lighting modes.

## Generated output

Each run creates a subfolder in `output/` named after the source texture:

```
output/
└── my_texture/
    ├── my_texture_alb.png
    ├── my_texture_nrm.png
    ├── my_texture_rgh.png
    └── my_texture_ao.png
```

## Project layout

```
├── src/
│   ├── generators.py        # PBR map algorithms (normal, roughness, AO)
│   ├── image_processing.py  # Loads input, runs generators, writes output
│   ├── utils.py             # Shared helpers
│   └── texture_generator.py # Original CLI script (reference)
├── output/                  # Generated map folders land here
├── samples/                 # Drop test textures here
├── assets/                  # icon.ico, logo.png
├── app.html                 # Browser UI (served by Flask)
├── server.py                # Flask backend — generation + file serving
├── launcher.py              # Legacy Python GUI entry point
├── build.py                 # PyInstaller EXE builder
├── Run PBR Generator.bat    # Double-click launcher
├── create_shortcut.py       # Places a Desktop shortcut
└── requirements.txt
```

## Requirements

- Python 3.10+
- See `requirements.txt` for packages (Flask, OpenCV, Pillow, CustomTkinter)

## Build standalone EXE

```bash
python build.py
```

Output appears in `dist/`. Drop `assets/icon.ico` in place first if you want a custom icon.
