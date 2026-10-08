"""The game's own battle HUD pieces for the Versus player (Viewer.cs ViewerHud.cs), read out of the game's main build
once into data/battle_ui/v<VERSION>/ (never shipped with the app): the unit HP shape and the boss HP bar, the enemy
info panel (the boss's code), the clash count's ink blot and brush digits (ParryingFont: '0'-'9', 'X' = 합), and the
HUD's two fonts — ExcelsiorSans for numbers, BebasKai for text — drawn into glyph sheets (the player can't open a font
file), described in hud.json."""
from __future__ import annotations

import glob
import io
import json
import os
import threading

VERSION = 2
_lock = threading.Lock()
# the font sheets: the characters drawn (anything else is left out of a name), the size they are drawn at
CHARS = "".join(chr(c) for c in range(32, 127)) + "".join(chr(c) for c in range(160, 256)) + "‘’“”–—…•№"
SIZE = 96


def folder(svc) -> str:
    """data/battle_ui/v<VERSION> with everything in it (made the first time, a few seconds), or "" when the game's
    files don't have the pieces."""
    out = os.path.join(svc.data_dir, "battle_ui", f"v{VERSION}")
    if os.path.exists(os.path.join(out, "hud.json")):
        return out
    with _lock:
        if os.path.exists(os.path.join(out, "hud.json")):
            return out
        try:
            _make(svc.game.data or "", out)
        except Exception as e:  # (an older or odd build: the player falls back to its plain HUD)
            print("battle_ui:", e)
            return ""
    return out if os.path.exists(os.path.join(out, "hud.json")) else ""


def _make(game_data: str, out: str) -> None:
    import UnityPy
    from PIL import Image, ImageChops
    tex_want = {"FX_Tex_UI_Battle_HP": "hp_unit", "FX_Tex_UI_Battle_HP_Boss": "hp_boss", "BattleUI_ParryingTypo": "typo",
                "ParryingFont0602_2_0": "ink_font"}
    got, fonts, ink_rects = {}, {}, None
    files = [os.path.join(game_data, "resources.assets")] + sorted(glob.glob(os.path.join(game_data, "sharedassets*.assets")))
    for fp in files:
        if len(got) == len(tex_want) + 1 and len(fonts) == 2 and ink_rects:
            break
        try:
            env = UnityPy.load(fp)
        except Exception:
            continue
        for o in env.objects:
            t = o.type.name
            if t not in ("Texture2D", "Font"):
                continue
            try:
                n = o.peek_name()
            except Exception:
                continue
            if t == "Texture2D" and (n in tex_want and tex_want[n] not in got or "SpriteAtlas_EnemyInfoUI" in n and "info" not in got):
                try:
                    got[tex_want.get(n, "info")] = o.read().image.convert("RGBA")
                except Exception:
                    pass
            elif t == "Font" and n in ("ExcelsiorSans", "BebasKai", "ParryingFont0602_2"):
                try:
                    d = o.read_typetree()
                except Exception:
                    continue
                if n == "ParryingFont0602_2":
                    ink_rects = {chr(r["index"]): r["uv"] for r in d.get("m_CharacterRects") or [] if r["index"] in range(48, 58) or r["index"] == 88}
                    continue
                data = bytes(d.get("m_FontData") or [])
                if data and len(data) > len(fonts.get(n, b"")):  # (two BebasKai: the bigger, fuller one)
                    fonts[n] = data
    need = set(tex_want.values()) | {"info"}
    if need - set(got) or len(fonts) < 2 or not ink_rects:
        raise ValueError(f"missing {sorted(need - set(got))} fonts {sorted(fonts)} ink {bool(ink_rects)}")
    os.makedirs(out, exist_ok=True)
    for k in ("hp_unit", "hp_boss"):  # (masks: white on black — their brightness is the shape, tinted by the player)
        im = got[k]
        a = ImageChops.multiply(im.getchannel("A"), im.convert("L"))
        mask = Image.new("RGBA", im.size, (255, 255, 255, 0))
        mask.putalpha(a)
        mask.save(os.path.join(out, f"{k}.png"))
    got["info"].crop((10, 40, 180, 118)).save(os.path.join(out, "code_panel.png"))  # (the panel with the bronze frame)
    typo = got["typo"]
    s = typo.width // 4
    typo.crop((3 * s, 0, 4 * s, s)).save(os.path.join(out, "ink_blot.png"))  # (the grid's first blot)
    ink = got["ink_font"]
    ink.save(os.path.join(out, "ink_font.png"))
    W, H = ink.size
    ink_chars = "".join(sorted(ink_rects))
    ink_boxes = [v for c in ink_chars for v in (round(ink_rects[c]["x"] * W), round((1 - ink_rects[c]["y"] - ink_rects[c]["height"]) * H),
                                                round(ink_rects[c]["width"] * W), round(ink_rects[c]["height"] * H))]
    meta = {"v": VERSION, "inkChars": ink_chars, "inkBoxes": ink_boxes,
            "fonts": {"num": _sheet(fonts["ExcelsiorSans"], os.path.join(out, "num.png")),
                      "txt": _sheet(fonts["BebasKai"], os.path.join(out, "txt.png"))}}
    with open(os.path.join(out, "hud.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)


def _sheet(ttf: bytes, path: str) -> dict:
    """the font's characters (CHARS) drawn white into one sheet: {"size", "cap" (a capital's height), "line", "chars",
    "boxes": [x, y, w, h, left, top, advance] for each of chars} in pixels (y down in the sheet), left / top from the
    pen on the baseline (top up). (Flat lists: the player's JSON reader takes no maps.)"""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(io.BytesIO(ttf), SIZE)
    pad = 4
    boxes = []
    for ch in CHARS:
        try:
            if ch != " " and not font.getmask(ch).getbbox():
                continue
        except Exception:
            continue
        l, t, r, b = font.getbbox(ch, anchor="ls")
        boxes.append((ch, l, t, max(r, l + 1), max(b, t + 1), font.getlength(ch)))
    W = 2048
    x = y = row = 0
    place = {}
    for ch, l, t, r, b, adv in boxes:
        w, h = r - l + 2 * pad, b - t + 2 * pad
        if x + w > W:
            x, y, row = 0, y + row, 0
        place[ch] = (x, y, w, h)
        x += w
        row = max(row, h)
    Hh = 1
    while Hh < y + row:
        Hh *= 2
    img = Image.new("RGBA", (W, Hh), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    chars, flat = "", []
    for ch, l, t, r, b, adv in boxes:
        px, py, w, h = place[ch]
        d.text((px + pad - l, py + pad - t), ch, font=font, fill=(255, 255, 255, 255), anchor="ls")
        chars += ch
        flat += [px, py, w, h, l - pad, -(t - pad), round(adv, 2)]
    img.save(path)
    cap = -font.getbbox("H", anchor="ls")[1]
    asc, desc = font.getmetrics()
    return {"size": SIZE, "cap": cap, "line": asc + desc, "chars": chars, "boxes": flat}
