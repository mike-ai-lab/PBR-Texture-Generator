"""
Entry point — run this to start the PBR Texture Generator GUI.
"""
import sys
import os

# Ensure project root is on the path so 'src' package resolves correctly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.ui import App

if __name__ == "__main__":
    app = App()
    app.mainloop()
