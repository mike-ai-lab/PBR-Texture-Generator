"""
Kiro task-done notifier
Sends a Windows toast notification with a wave emoji when Kiro finishes a task.
"""
import subprocess, sys

def notify_windows():
    script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$n = New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon = [System.Drawing.SystemIcons]::Information;"
        "$n.Visible = $true;"
        "$n.ShowBalloonTip(4000, 'Kiro', '👋 Done! Come back when ready.', [System.Windows.Forms.ToolTipIcon]::None);"
        "Start-Sleep -Seconds 5;"
        "$n.Dispose()"
    )
    subprocess.Popen(
        ["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
        creationflags=subprocess.CREATE_NO_WINDOW
    )

if __name__ == "__main__":
    notify_windows()
