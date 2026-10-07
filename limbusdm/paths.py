"""Locate the game install, its downloaded data and our own data folder."""
from __future__ import annotations

import os
import re
import sys

APP_NAME = "LimbusArchive"
STEAM_APP_DIR = "Limbus Company"
LOCALLOW = os.path.expandvars(r"%USERPROFILE%\AppData\LocalLow")


def steam_libraries() -> list[str]:
    libs = []
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            steam = winreg.QueryValueEx(k, "SteamPath")[0]
        libs.append(os.path.normpath(steam))
        vdf = os.path.join(steam, "steamapps", "libraryfolders.vdf")
        if os.path.exists(vdf):
            with open(vdf, encoding="utf-8", errors="replace") as f:
                libs += [os.path.normpath(p.replace("\\\\", "\\")) for p in re.findall(r'"path"\s+"([^"]+)"', f.read())]
    except OSError:
        pass
    for drive in "CDEFGH":
        for p in (r"Program Files (x86)\Steam", "SteamLibrary", r"Games\Steam", r"Games\SteamLibrary"):
            libs.append(f"{drive}:\\{p}")
    seen, out = set(), []
    for p in libs:
        if p.lower() not in seen:
            seen.add(p.lower())
            out.append(p)
    return out


def find_game_dir() -> str | None:
    for lib in steam_libraries():
        p = os.path.join(lib, "steamapps", "common", STEAM_APP_DIR)
        if os.path.exists(os.path.join(p, "LimbusCompany_Data")):
            return p
    return None


def app_dir() -> str:
    """Folder of the app itself (next to the exe when frozen, repo root otherwise)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def data_dir() -> str:
    """Our data folder: next to the exe/repo; a built exe in <repo>\\LimbusArchive\\ uses the repo's data\\."""
    base = app_dir()
    parent = os.path.dirname(base)
    if (getattr(sys, "frozen", False) and not os.path.isdir(os.path.join(base, "data"))
            and os.path.isdir(os.path.join(parent, "limbusdm"))):
        return os.path.join(parent, "data")
    return os.path.join(base, "data")


def resource_dir() -> str:
    """Bundled read-only resources (ui/)."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", app_dir())
    return app_dir()


class GamePaths:
    def __init__(self, game_dir: str | None = None):
        self.game = game_dir or find_game_dir()
        self.data = os.path.join(self.game, "LimbusCompany_Data") if self.game else None
        self.streaming = os.path.join(self.data, "StreamingAssets") if self.data else None
        self.locallow = os.path.join(LOCALLOW, "ProjectMoon", "LimbusCompany")
        self.cache = os.path.join(LOCALLOW, "Unity", "ProjectMoon_LimbusCompany")

    @property
    def ok(self) -> bool:
        return bool(self.game and os.path.isdir(self.data))

    def catalog_path(self) -> str | None:
        """The catalog the game actually uses: the downloaded one, else the one shipped with the install."""
        for p in (os.path.join(self.locallow, "com.unity.addressables", "catalog_S1.bin"),
                  os.path.join(self.streaming or "", "aa", "catalog.bin")):
            if os.path.exists(p):
                return p
        return None

    def catalog_hash_path(self) -> str | None:
        p = self.catalog_path()
        return p[:-4] + ".hash" if p else None

    def bundle_file(self, name: str, hash_: str, url: str) -> str | None:
        if url.startswith("{"):
            # {UnityEngine.AddressableAssets.Addressables.RuntimePath}\...  → StreamingAssets\aa\...
            rel = url.split("}", 1)[1].lstrip("\\/")
            p = os.path.join(self.streaming, "aa", rel)
            return p if os.path.exists(p) else None
        p = os.path.join(self.cache, name, hash_, "__data")
        return p if os.path.exists(p) else None
