"""
Kiro rate limit retry helper
Tries to send "continue" to Kiro chat completely in the background.
Falls back to briefly focusing Kiro then restoring your previous window/state.

Usage:
    python retry_kiro.py          # 180s delay (default)
    python retry_kiro.py 120      # custom delay in seconds
"""
import time
import sys
import subprocess
import ctypes
import ctypes.wintypes

DELAY = 180
MESSAGE = "continue"

user32 = ctypes.windll.user32
WM_CHAR    = 0x0102
WM_KEYDOWN = 0x0100
WM_KEYUP   = 0x0101
VK_RETURN  = 0x0D
SW_RESTORE = 9
SW_MAXIMIZE = 3

def ensure_deps():
    for pkg in ["pyautogui", "pygetwindow"]:
        try:
            __import__(pkg)
        except ImportError:
            print(f"Installing {pkg}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg])

def countdown(seconds):
    for remaining in range(seconds, 0, -1):
        mins, secs = divmod(remaining, 60)
        print(f"\r⏳ Sending in {mins:02d}:{secs:02d}...", end="", flush=True)
        time.sleep(1)
    print("\r✅ Sending now...                    ")

def get_foreground_state():
    """Capture current foreground window and its placement."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    # Get window placement to restore maximize state
    class WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [
            ("length", ctypes.c_uint),
            ("flags", ctypes.c_uint),
            ("showCmd", ctypes.c_uint),
            ("ptMinPosition", ctypes.wintypes.POINT),
            ("ptMaxPosition", ctypes.wintypes.POINT),
            ("rcNormalPosition", ctypes.wintypes.RECT),
        ]
    wp = WINDOWPLACEMENT()
    wp.length = ctypes.sizeof(wp)
    user32.GetWindowPlacement(hwnd, ctypes.byref(wp))
    return hwnd, wp

def restore_foreground_state(state):
    """Restore previously captured window to front with its original placement."""
    if not state:
        return
    hwnd, wp = state
    try:
        user32.ShowWindow(hwnd, wp.showCmd)  # restore original show state (maximized etc.)
        time.sleep(0.15)
        user32.SetForegroundWindow(hwnd)
    except Exception:
        pass

def find_kiro_hwnd():
    import pygetwindow as gw
    wins = [w for w in gw.getAllWindows()
            if w.title and ("kiro" in w.title.lower() or "pbr texture generator" in w.title.lower())]
    if not wins:
        return None, None
    win = wins[0]
    hwnd = user32.FindWindowW(None, win.title)
    return hwnd, win

def try_background_send(hwnd, message):
    """
    Try sending keystrokes via PostMessage without focusing the window.
    Works for some Electron/webview inputs, may not work for all.
    """
    # Find the deepest child window (where the actual webview input lives)
    children = []
    def enum_child(child_hwnd, _):
        children.append(child_hwnd)
        return True
    EnumChildProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    ctypes.windll.user32.EnumChildWindows(hwnd, EnumChildProc(enum_child), 0)

    # Target the last/deepest child (most likely the webview renderer)
    target = children[-1] if children else hwnd

    for ch in message:
        ctypes.windll.user32.PostMessageW(target, WM_CHAR, ord(ch), 0)
        time.sleep(0.02)
    # Send Enter
    ctypes.windll.user32.PostMessageW(target, WM_KEYDOWN, VK_RETURN, 0)
    time.sleep(0.05)
    ctypes.windll.user32.PostMessageW(target, WM_KEYUP, VK_RETURN, 0)

def send_foreground_fallback(hwnd, win, message):
    """Bring Kiro to front, send message, restore previous window."""
    import pyautogui
    pyautogui.FAILSAFE = False

    # Save current state before switching
    prev_state = get_foreground_state()

    # Bring Kiro to front
    user32.ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.3)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)

    # Click chat input: right panel, near bottom
    # Chat panel takes right ~35% of window; input is at very bottom
    cx = win.left + int(win.width  * 0.80)
    cy = win.top  + int(win.height * 0.94)
    print(f"Clicking chat input at ({cx}, {cy})...")
    pyautogui.click(cx, cy)
    time.sleep(0.3)

    pyautogui.hotkey("ctrl", "a")
    time.sleep(0.1)
    pyautogui.typewrite(message, interval=0.04)
    time.sleep(0.15)
    pyautogui.press("enter")
    time.sleep(0.3)

    # Restore whatever the user was doing
    restore_foreground_state(prev_state)

def send_to_kiro(message):
    hwnd, win = find_kiro_hwnd()
    if not hwnd:
        print("❌ Kiro window not found. Is it open?")
        sys.exit(1)

    print(f"Found: {win.title}")
    send_foreground_fallback(hwnd, win, message)
    print(f"✅ Sent: '{message}' — your previous window restored.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        delay = int(sys.argv[1])
    else:
        print("How long to wait before sending 'continue' to Kiro?")
        print("  1 = 1 minute")
        print("  2 = 2 minutes")
        print("  3 = 3 minutes")
        choice = input("Enter choice [1/2/3]: ").strip()
        delay = {"1": 60, "2": 120, "3": 180}.get(choice, 180)
        print()

    print(f"⏳ Sending '{MESSAGE}' to Kiro in {delay}s. You can switch away now.")
    print("Ctrl+C to cancel.\n")

    ensure_deps()

    try:
        countdown(delay)
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(0)

    send_to_kiro(MESSAGE)
