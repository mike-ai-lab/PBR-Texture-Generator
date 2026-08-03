"""
Creates a desktop shortcut using PowerShell (no extra packages needed).
Usage:  python create_shortcut.py
"""
import os
import subprocess
import sys

project_dir   = os.path.dirname(os.path.abspath(__file__)).replace("'", "''")
bat_path      = os.path.join(project_dir, "Run PBR Generator.bat")
icon_path     = os.path.join(project_dir, "assets", "icon.ico")
desktop       = os.path.join(os.path.expanduser("~"), "Desktop")
shortcut_path = os.path.join(desktop, "PBR Texture Generator.lnk")

icon_line = f"$sc.IconLocation = '{icon_path}'" if os.path.exists(icon_path) else ""

ps_script = f"""
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut('{shortcut_path}')
$sc.TargetPath       = '{bat_path}'
$sc.WorkingDirectory = '{project_dir}'
$sc.Description      = 'PBR Texture Generator'
$sc.WindowStyle      = 7
{icon_line}
$sc.Save()
"""

result = subprocess.run(
    ["powershell", "-NoProfile", "-Command", ps_script],
    capture_output=True, text=True
)

if result.returncode == 0:
    print(f"Shortcut created: {shortcut_path}")
else:
    print("Failed:")
    print(result.stderr)
    sys.exit(1)
