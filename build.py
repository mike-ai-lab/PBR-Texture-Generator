"""
Creates a standalone .exe with PyInstaller.
Run:  python build.py
"""
import subprocess
import sys

cmd = [
    sys.executable, "-m", "PyInstaller",
    "--onefile",
    "--windowed",
    "--name", "PBR Texture Generator",
    "--icon", "assets/icon.ico",
    "--add-data", "assets;assets",
    "launcher.py",
]

subprocess.run(cmd, check=True)
