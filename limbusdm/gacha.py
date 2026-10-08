"""Games → Extraction (ui/games5.js): the game's own banners, pools and chances, the lines said on getting a unit,
the sounds of the extraction and the pictures its screens are made of. Read-only on the game.

- Banners: StaticData gacha/gacha-<id>.json — the featured units, the groups a pull falls into with their shares of
  10000 (for a plain pull, the tenth of a ten, and the same with every E.G.O of the banner owned), the dates.
- The art's three passes when a unit is shown: StaticData gacha-panning (only the first Identities have one).
- Sounds: samples named "0NN_뽑기 연출_…" in the SFX banks, played by /api/quiz_audio like any sample.
- Pictures: sprites of the main build (resources.assets / sharedassets*), cut once into the UI cache.
"""
from __future__ import annotations

import datetime
import glob
import json
import os
import re
import sqlite3
import threading

VERSION = 1
GACHA = "Assets/Resources_moved/Gacha/"
# sprites and textures of the extraction's screens, by their names in the main build
# the pieces of the game's own menus the app's look is made of (ui/skin.css): frames, plates, the menu's icons
SKIN = (["MainUI_common_Popup_01_" + n for n in ("23", "26", "27", "37", "btn_t1_normal", "btn_t1_hover")] + ["MainUI_common_Popup_03_23", "MainUI_UserInfo_2_3", "MainUI_UserInfo_2_6",
         "MainUI_Inventory_1_21", "MainUI_Settings_3_8", "MainUI_Settings_3_10"] + [f"New_MainUI_PersonalityList_2_{n}" for n in (2, 19, 26, 27)]
        + [f"MainUI_BottomMenu_1_{n}" for n in (9, 10, 11, 12, 13, 14, 19, 21)] + [f"MainUI_Lobby_new_1_{n}" for n in (0, 1, 2, 3, 9, 10)])
UI_RE = re.compile(r"^(MainUI_Gacha_\w+|MainUI_Logoicon_filter_\d+|gacharesult_\w+|FX_Tex_UI_Gacha_\w+|icon_lunacy|" + "|".join(SKIN) + r")$")
# the ones the page draws (ui/games5.js, ui/style.css): what the web copy takes
UI_USED = (["icon_lunacy", "MainUI_Gacha_5", "MainUI_Gacha_3_4", "MainUI_Gacha_4_Illust_Skip", "MainUI_Gacha_4_Card_EgoRing", "FX_Tex_UI_Gacha_BGSpace_Normal", "FX_Tex_UI_Gacha_Chain2",
            "FX_Tex_UI_Gacha_Chain_Long1", "FX_Tex_UI_Gacha_Crack1_Main", "FX_Tex_UI_Gacha_Crack1_Space"]
           + [f"MainUI_Gacha_4_Card_Foreground_{n}" for n in (1, 2, 3)] + [f"MainUI_Gacha_3_Rank{n}" for n in (1, 2, 3)] + [f"MainUI_Gacha_4_Illust_Rank_{n}" for n in (1, 2, 3)]
           + [f"MainUI_Gacha_4_Illust_E{i + 1}_{g}" for i, g in enumerate(["ZAYIN", "TETH", "HE", "WAW", "ALEPH"])] + [f"MainUI_Logoicon_filter_{n}" for n in range(12)] + SKIN)
_lock = threading.Lock()


def build(svc) -> dict:
    """{"banners": [{id, pick, tile, typo, illust, end, groups: [{g, ids, occ}]}], "pan": {id: [[x, y, direction] × 3]},
    "lines": {E.G.O id: [sample, text]}, "snd": {key: sample}, "v"} — banners open today first, the standard one last."""
    from .viewer import sound_index
    sid = svc.latest_snapshot_id()
    if not sid:
        return {"banners": [], "pan": {}, "lines": {}, "snd": {}, "v": VERSION}
    cached = getattr(svc, "_gacha", None)
    if cached and cached[0] == sid:
        return cached[1]
    tabs = svc.static_tables(["gacha", "gacha-panning"])
    have = set()
    path = svc.ensure_browse()
    if path:
        con = sqlite3.connect(path)
        have = {c for (c,) in con.execute("select c from o where type = 'Texture2D' and c like ?", (GACHA + "%",))}
        con.close()
    pic = lambda folder, name: GACHA + folder + "/" + name if GACHA + folder + "/" + name in have else ""  # noqa: E731
    now, banners = datetime.datetime.utcnow().isoformat(), []
    for t in (tabs.get("gacha") or {}).values():
        for b in t.get("list") or []:
            info, folder = b.get("bannerInfo") or {}, ((b.get("bannerInfo") or {}).get("illustList") or [""])[0]
            groups = [{"g": c.get("groupType"), "ids": c.get("elementIdList") or [],
                       "occ": {o["occupancyCase"]: o["occupancy"] for o in c.get("occupancyCaseList") or []}} for c in b.get("contents") or []]
            # (the guaranteed-000 tickets and the like: no E.G.O and no featured unit — not a banner to pull tens on)
            if info.get("bannerType") == "PERMANENT" or not groups:
                continue
            banners.append({"id": b["id"], "kind": info.get("bannerType"), "pick": info.get("pickupIdList") or [], "end": b.get("endDate") or "",
                            "tile": pic(folder, "banner_en.png"), "typo": pic(folder, "typo_en.png"), "illust": pic(folder, "illust.png"), "groups": groups})
    open_ = [b for b in banners if b["kind"] == "DEFAULT" or b["end"] > now]
    if not any(b["pick"] for b in open_):  # an old snapshot: its banners have all ended — the newest ones then
        open_ = sorted(banners, key=lambda b: b["id"])[-3:] + [b for b in banners if b["kind"] == "DEFAULT"]
    open_ = sorted({b["id"]: b for b in open_}.values(), key=lambda b: (b["kind"] == "DEFAULT", -b["id"]))
    pan = {}
    for t in (tabs.get("gacha-panning") or {}).values():
        for r in t.get("wideScreen") or []:
            pan[r["id"]] = [[d["rootX"], d["rootY"], d["panningDirection"]] for d in (r.get(f"root{i}Data") for i in (1, 2, 3)) if d]
    idx = sound_index(svc)
    snd = {}
    for name in idx:
        m = re.match(r"(\d{3})_뽑기 연출", name)
        if m:
            snd[m.group(1)] = name
        elif name in ("gacha_result", "gacha_whoosh", "sfx_ticket_use"):
            snd[name] = name
    lines = {}
    loc = os.path.join(svc.game.data or "", "Assets", "Resources_moved", "Localize", "en", "EGOVoiceDig")
    for fp in sorted(glob.glob(os.path.join(loc, "EN_Voice_EGO_*.json"))):
        try:
            with open(fp, encoding="utf-8-sig") as f:
                rows = json.load(f).get("dataList") or []
        except Exception:
            continue
        for r in rows:
            m = re.fullmatch(r"battle_awaken_(\d+)_1", str(r.get("id") or ""))
            if m and r.get("dlg"):
                lines.setdefault(m.group(1), [r["id"] if r["id"].lower() in idx else "", r["dlg"]])
    out = {"banners": open_, "pan": pan, "lines": lines, "snd": snd, "v": VERSION}
    svc._gacha = (sid, out)
    return out


def ui_png(name: str, game_data: str, cache_dir: str) -> tuple[bytes, str] | None:
    """One picture of the extraction's screens → (bytes, mime). All of them are cut on the first call (a few seconds)."""
    if not UI_RE.match(name) or not game_data:
        return None
    folder = os.path.join(cache_dir, "gacha")
    with _lock:
        if not os.path.exists(os.path.join(folder, ".done3")):
            _extract(game_data, folder)
    for ext, mime in ((".png", "image/png"), (".jpg", "image/jpeg")):
        fp = os.path.join(folder, name + ext)
        if os.path.exists(fp):
            with open(fp, "rb") as f:
                return f.read(), mime
    return None


def _extract(game_data: str, folder: str) -> None:
    import UnityPy
    from . import bundles as _bundles  # noqa: F401  (sets the Unity fallback version)
    os.makedirs(folder, exist_ok=True)
    for fp in [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets"))):
        try:
            env = UnityPy.load(fp)
        except Exception:
            continue
        for o in env.objects:
            kind = o.type.name
            if kind not in ("Sprite", "Texture2D"):
                continue
            try:
                n = o.peek_name()
            except Exception:
                continue
            # (a sprite sheet's texture has its sprites' names' start: only the effects' textures are taken whole)
            if not UI_RE.match(n) or (kind == "Texture2D" and n.startswith("MainUI_")):
                continue
            try:
                img = o.read().image
                if n.startswith("FX_Tex_UI_Gacha_BGSpace") or n == "MainUI_Settings_3_8":  # the sky behind the orb: 2048 px of noise, a photo's weight as PNG
                    img.convert("RGB").resize((1024, 1024)).save(os.path.join(folder, n + ".jpg"), "JPEG", quality=86)
                else:
                    img.save(os.path.join(folder, n + ".png"), "PNG")
            except Exception:
                continue
    with open(os.path.join(folder, ".done3"), "w") as f:
        f.write("1")
