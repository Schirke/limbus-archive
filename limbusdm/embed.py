"""The skill player's window inside the app's window (Windows): a child window laid over the page's stage box."""
import ctypes
import sys
from ctypes import wintypes

_u = ctypes.windll.user32 if sys.platform == "win32" else None
SW_HIDE, SW_SHOWNA = 0, 8
HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0, 0x10, 0x40


def child_of(parent: int, pid: int) -> int:
    """The window of process `pid` under `parent` (0 until it exists)."""
    if not _u or not parent:
        return 0
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        p = wintypes.DWORD()
        _u.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid:
            found.append(hwnd)
        return True
    _u.EnumChildWindows(parent, each, 0)
    return found[0] if found else 0


def place(hwnd: int, x: int, y: int, w: int, h: int, clip=None):
    """Over the box (pixels from the app window's client corner), above the page. clip (left, top, right, bottom in the
    window's own pixels): only that part shows, where the page is scrolled and the box is cut off."""
    if _u and hwnd:
        _u.SetWindowPos(hwnd, HWND_TOP, int(x), int(y), max(1, int(w)), max(1, int(h)), SWP_NOACTIVATE | SWP_SHOWWINDOW)
        _g = ctypes.windll.gdi32
        rgn = _g.CreateRectRgn(*[int(v) for v in clip]) if clip else 0
        _u.SetWindowRgn(hwnd, rgn, True)  # (the window owns the region now)
        _u.EnableWindow(hwnd, False)  # (clicks on the picture don't take the keys from the page)


def grab(hwnd: int):
    """The window's picture as it is on the screen now (a PIL image), None when it isn't shown."""
    if not _u or not hwnd or not _u.IsWindowVisible(hwnd):
        return None
    from PIL import ImageGrab
    old = _u.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # (screen pixels, as the grab reads them)
    try:
        r = wintypes.RECT()
        if not _u.GetWindowRect(hwnd, ctypes.byref(r)) or r.right - r.left < 8 or r.bottom - r.top < 8:
            return None
        return ImageGrab.grab(bbox=(r.left, r.top, r.right, r.bottom), all_screens=True)
    finally:
        if old:
            _u.SetThreadDpiAwarenessContext(ctypes.c_void_p(old))


def hide(hwnd: int):
    if _u and hwnd:
        _u.ShowWindow(hwnd, SW_HIDE)
