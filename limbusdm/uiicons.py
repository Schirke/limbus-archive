"""The game's own UI icons (sins, resistances, damage types, statuses, ranks…) cut from the main build
(resources.assets / sharedassets*.assets) on first use and kept as PNG in data/ui_icons. Read-only on the game."""
from __future__ import annotations

import glob
import os
import threading

from . import bundles as _bundles  # noqa: F401  (sets the Unity fallback version)

PL = "MainUI_PersonalityList_"
# icon key -> sprite name. The Identity screen's atlas slices have generic names; if a patch renames them the
# key just 404s and the page falls back to text.
ICONS = {
    **{f"sin_{s}": f"{PL}4_{i}" for i, s in enumerate(["Wrath", "Lust", "Sloth", "Gluttony", "Gloom", "Pride", "Envy"])},
    "hp": f"{PL}4_22", "def": f"{PL}4_23",
    "res_Slash": f"{PL}4_24", "res_Pierce": f"{PL}4_32", "res_Blunt": f"{PL}4_31",
    "atk_Slash": "Icon_AttackType_slash", "atk_Pierce": "Icon_AttackType_pierce", "atk_Blunt": "Icon_AttackType_hit",
    "def_Guard": "Icon_AttackType_guard", "def_Evade": "Icon_AttackType_evade", "def_Counter": "Icon_AttackType_counter",
    **{f"st_{k}": f"Personality{k}" for k in ["Combustion", "Laceration", "Vibration", "Burst", "Sinking", "Breath", "Charge"]},
    **{f"rank_{n}": f"MainUI_Gacha_3_Rank{n}" for n in (1, 2, 3)},
    "up_1": f"{PL}4_18", "up_2": f"{PL}4_17", "up_3": f"{PL}4_16", "up_4": f"{PL}4_37",
    "grade_ZAYIN": f"{PL}3_27", "grade_TETH": f"{PL}3_28", "grade_HE": f"{PL}3_38", "grade_WAW": f"{PL}3_39",
    "grade_ALEPH": f"{PL}3_29",
    # skill coins as the battle UI draws them: plain bronze, Unbreakable (red), the purple / green special coins
    "coin": "BattleUI_NewCoin_0", "coin_super": "BattleUI_NewCoin_3", "coin_purple": "BattleUI_NewCoin_14",
    "coin_green": "BattleUI_NewCoin_11",
}

_lock = threading.Lock()


def _extract_all(game_data: str, cache_dir: str) -> None:
    """One pass over the main build: every icon in ICONS saved as a small PNG (a few seconds, once)."""
    import io
    import UnityPy
    os.makedirs(cache_dir, exist_ok=True)
    by_name = {v: k for k, v in ICONS.items() if not os.path.exists(os.path.join(cache_dir, f"{k}.png"))}
    files = [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets")))
    left = set(by_name)
    for fp in files:
        if not left:
            break
        try:
            env = UnityPy.load(fp)
        except Exception:
            continue
        for o in env.objects:
            if o.type.name != "Sprite":
                continue
            try:
                n = o.peek_name()
            except Exception:
                continue
            if n not in left:
                continue
            try:
                img = o.read().image
                img.thumbnail((128, 128))
                buf = io.BytesIO()
                img.save(buf, "PNG")
                with open(os.path.join(cache_dir, f"{by_name[n]}.png"), "wb") as f:
                    f.write(buf.getvalue())
                left.discard(n)
            except Exception:
                continue
    with open(os.path.join(cache_dir, ".done"), "w") as f:  # every key looked for, then the ones the game no longer has
        f.write(" ".join(sorted(ICONS)) + "\n" + " ".join(sorted(by_name[n] for n in left)))


def _done(cache_dir: str) -> bool:
    """Extraction ran for the current ICONS (a newer app version can add keys: look for those once more)."""
    try:
        with open(os.path.join(cache_dir, ".done")) as f:
            lines = f.read().split("\n")
    except OSError:
        return False
    return len(lines) > 1 and set(ICONS) <= set(lines[0].split())


# the fonts the game draws its UI with (embedded in the main build), by the name the page asks for
FONTS = ("BebasKai", "Mikodacs", "ExcelsiorSans", "Pretendard-Regular")
SEASON_TAGS = "IntColorPairs_UnitInfoSeasonTag"  # the season label's colour on the Identity screen, per season id


def _extract_extras(game_data: str, cache_dir: str) -> None:
    """One more pass over the main build: the UI fonts and the season colours (seasons.json: {season id: "#rrggbb"})."""
    import json
    import struct
    import UnityPy
    os.makedirs(cache_dir, exist_ok=True)
    seasons: dict[str, str] = {}
    files = [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets")))
    left = set(FONTS)
    for fp in files:
        if not left and seasons:
            break
        try:
            env = UnityPy.load(fp)
        except Exception:
            continue
        for o in env.objects:
            try:
                if o.type.name == "Font" and left:
                    d = o.read()
                    data = bytes(d.m_FontData or b"")
                    if d.m_Name in left and len(data) > 1000:
                        with open(os.path.join(cache_dir, f"{d.m_Name}.font"), "wb") as f:
                            f.write(data)
                        left.discard(d.m_Name)
                elif o.type.name == "MonoBehaviour" and not seasons and o.byte_size < 4096:
                    # no type tree in the main build: m_GameObject (12) m_Enabled (4) m_Script (12), the name, some
                    # other fields, then the list as a count and (int season, 4 float colour) entries up to the end
                    raw = o.get_raw_data()
                    n = struct.unpack_from("<i", raw, 28)[0]
                    if n != len(SEASON_TAGS) or raw[32:32 + n] != SEASON_TAGS.encode():
                        continue
                    for at in range(32 + (n + 3) // 4 * 4, len(raw) - 24, 4):
                        count = struct.unpack_from("<i", raw, at)[0]
                        if not 0 < count <= 64 or at + 4 + count * 20 > len(raw):
                            continue
                        rows = [struct.unpack_from("<i4f", raw, at + 4 + i * 20) for i in range(count)]
                        if all(0 < r[0] < 100000 and r[4] == 1.0 and all(0 <= v <= 1 for v in r[1:4]) for r in rows):
                            for sid, r, g, b, _a in rows:
                                seasons[str(sid)] = "#%02x%02x%02x" % tuple(round(v * 255) for v in (r, g, b))
                            break
            except Exception:
                continue
    with open(os.path.join(cache_dir, "seasons.json"), "w") as f:
        json.dump(seasons, f)


def _extras(game_data: str, cache_dir: str) -> None:
    if not os.path.exists(os.path.join(cache_dir, "seasons.json")):
        with _lock:
            if not os.path.exists(os.path.join(cache_dir, "seasons.json")):
                _extract_extras(game_data, cache_dir)


def season_colors(game_data: str, cache_dir: str) -> dict[str, str]:
    import json
    if not game_data:
        return {}
    _extras(game_data, cache_dir)
    try:
        with open(os.path.join(cache_dir, "seasons.json")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def font_file(name: str, game_data: str, cache_dir: str) -> bytes | None:
    if name not in FONTS or not game_data:
        return None
    _extras(game_data, cache_dir)
    try:
        with open(os.path.join(cache_dir, f"{name}.font"), "rb") as f:
            return f.read()
    except OSError:
        return None


def icon_png(key: str, game_data: str, cache_dir: str) -> bytes | None:
    if key not in ICONS or not game_data:
        return None
    path = os.path.join(cache_dir, f"{key}.png")
    if not os.path.exists(path) and not _done(cache_dir):
        with _lock:
            if not _done(cache_dir):
                _extract_all(game_data, cache_dir)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()
