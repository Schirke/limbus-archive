"""The game's music for the corner player: the official track list of its own jukebox (StaticData lobby-bgm +
EN_LobbyBGM names / authors) tied to the samples in the BGM banks, and where each battle theme plays (stage waves'
bgmList → Canto and the enemies fought there).

A table names an FMOD event ("event:/BGM/Battle/Battle_Cp1_Ally_2"), a bank holds samples under their file names
("LC_1장_아군전투_중반부_BGM_(완성본_LOOP)"), and the banks' event data has no names at all. So an event finds its
sample by name where they agree, else by the length the jukebox table gives it (to the millisecond), told apart by
the chapter / side in the sample's name when several are as long."""
from __future__ import annotations

import collections
import os
import re

from . import content, units

VERSION = 3
NEAR = 60  # ms an event's length may differ from its sample's
BOSS_FIGHTS = 3  # a theme heard in so few story fights is somebody's own: named after who is fought there
STORY_TABLES = ("battle-story", "battle-ab", "battle-dungeon")
PHASES = ["초반부", "전반부", "중반부", "후반부"]  # early, early, middle, late (the first Cantos' tracks are named in Korean)
# events whose jukebox version is cut from several samples (so no sample is as long): the one to play
ALIAS = {"LimbusCompany_BGM_PV": "BGM_PV", "Battle_Cp2_Rodion_Lobby": "Battle_Cp2_Rodion",
         "Battle_Cp3_BetweenTwoWorlds_Lobby": "Between Two Worlds_Master [Game Loop Part1]",
         "Battle_Cp4_FlyMyWings_Lobby": "Fly, My Wings_Main -13LUFS_Master_동랑 에고 보스전",
         "Battle_Cp4_DongLangEGOBattle": "Fly, My Wings_Main -13LUFS_Master_동랑 에고 보스전",
         "Battle_Cp5_Compass_Lobby": "Battle_Cp5_AhabBossBattle_AR", "Battle_Cp5_AhabBossBattle": "Battle_Cp5_AhabBossBattle_AR",
         "Battle_Cp6_ThroughPatchesOfViolet_Lobby": "CH6_All", "Battle_Cp7_Hero_Lobby": "Battle_Cp7_Boss_4",
         "Battle_Cp10_Boss_4_Vanilla": "Battle_Cp10_Boss_4", "City_Hero": "City_Hero_V",
         "Battle_Cp7_Boss_3_Lobby": "Battle_Cp7_Boss_3", "Battle_Cp8_TianTian_Lobby": "Battle_Cp8_Boss_4_AR",
         "Battle_Cp8_Boss_4": "Battle_Cp8_Boss_4_AR", "Battle_Cp9_Saikai_Lobby": "Battle_Cp9_Boss_10_AR",
         "Battle_Cp9_Boss_10": "Battle_Cp9_Boss_10_AR", "Battle_Cp9_Boss_10_Mirror": "Battle_Cp9_Boss_10_MR",
         "Battle_AhabBossBattle_Mirror": "Battle_Cp5_AhabBossBattle_MR",
         "Battle_Cp3_Cromer_p1": "크로머1페이즈BGM", "Battle_Cp3_Cromer_p2": "Lyric_Cromer_p2"}
# fight-only events that play a jukebox song without its vocals: named after the song, not after where they play
INSTRUMENTAL = {"Battle_AhabBossBattle_Mirror": "Battle_Cp5_Compass_Lobby", "Battle_Cp9_Boss_10_Mirror": "Battle_Cp9_Saikai_Lobby"}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9가-힣]", "", s.lower())


def _hints(event: str, sample: str) -> int:
    """How well a sample's name fits an event: its chapter ("Cp4_5" ~ "LC_4.5", "Cp3" ~ "3장") and side."""
    s, score = sample.lower(), 0
    m = re.search(r"cp(\d+)(_5)?", event.lower())
    if m:
        ch = m.group(1) + (".5" if m.group(2) else "")
        if re.search(rf"(lc|ch|cp)_?{re.escape(ch)}(장|_|$)(?!5_)", s) and (m.group(2) or ".5" not in s):
            score += 2
    for word, ko in (("ally", "아군"), ("enemy", "적전투"), ("boss", "보스"), ("lobby", "로비"), ("gatcha", "gatcha")):
        if word in event.lower() and (ko in s or word in s):
            score += 1
    return score


def _phase(sample: str) -> int:
    return next((i for i, p in enumerate(PHASES) if p in sample), 9)


def _resolve(events: dict[str, int | None], samples: list[tuple]) -> dict[str, tuple]:
    """{event: sample (name, ms, bank, index)}; events = {name: length in ms, None when unknown}."""
    by_name = {}
    for s in samples:
        by_name.setdefault(_norm(s[0]), s)
    out = {}
    for ev, ms in events.items():  # by name
        hit = by_name.get(_norm(ALIAS[ev])) if ev in ALIAS else None
        for cand in (ev, re.sub(r"^Battle_", "", ev), re.sub(r"-\d+$", "", ev), "LC_" + ev):
            hit = hit or by_name.get(_norm(cand))
        if hit:
            out[ev] = hit
    taken = {_norm(s[0]) for s in out.values()}
    for ev, ms in events.items():  # by length, among the samples no event is named after
        if ev in out or not ms:
            continue
        near = {_norm(s[0]): s for s in samples if abs(s[1] - ms) <= NEAR and _norm(s[0]) not in taken}
        if not near:
            continue
        best = max(_hints(ev, s[0]) for s in near.values())
        cands = sorted((s for s in near.values() if _hints(ev, s[0]) == best), key=lambda s: (_phase(s[0]), s[0]))
        if len(cands) > 1 and not best:
            continue  # as long as several unrelated tracks: can't tell
        m = re.search(r"(\d+)$", ev)
        out[ev] = cands[(int(m.group(1)) - 1) % len(cands) if m and len(cands) > 1 else 0]
    return out


def _where(tables: dict, chapters: dict, names: dict[int, str], bosses: set[int]) -> dict[str, dict]:
    """{event: {"label": the earliest story chapter it plays in, "order", "who": [enemy names, the most fought first]}}."""
    out: dict[str, dict] = {}
    for table in content.STAGE_TABLES:
        for fname, data in (tables.get(table) or {}).items():
            for st in (data.get("list") or []) if isinstance(data, dict) else []:
                if not isinstance(st, dict) or not isinstance(st.get("id"), int):
                    continue
                lab = content.stage_label(table, fname, st["id"], chapters)
                if not lab:
                    continue
                for wave in st.get("waveList") or []:
                    who = [u.get("unitID") for u in (wave or {}).get("unitList") or [] if isinstance(u, dict)]
                    for ev in (wave or {}).get("bgmList") or []:
                        w = out.setdefault(ev, {"lab": lab, "waves": 0, "who": collections.Counter(), "boss": collections.Counter()})
                        if lab[:2] < w["lab"][:2]:
                            w["lab"] = lab
                        if table in STORY_TABLES:
                            w["waves"] += 1
                            for uid in set(who):
                                if names.get(uid):
                                    w["boss" if uid in bosses else "who"][names[uid]] += 1
    res = {}
    for ev, w in out.items():
        who = [n for n, _ in w["boss"].most_common(3)] or [n for n, _ in w["who"].most_common(3)]
        res[ev] = {"label": re.sub(r" · Part \d+$", "", w["lab"][2]), "order": w["lab"][:2], "waves": w["waves"], "who": who}
    return res


def build(tables: dict, loc_dir: str, samples: list[tuple]) -> dict:
    """tables: StaticData lobby-bgm, enemy tables and the stage tables; samples: (name, ms, bank path, index) of the BGM banks."""
    loc = units._load(loc_dir, r"EN_LobbyBGM(-\d+)?\.json$")
    rows = [r for d in (tables.get("lobby-bgm") or {}).values() for r in (d.get("dataList") or []) if isinstance(d, dict)]
    rows = sorted((r for r in rows if isinstance(r, dict) and r.get("fileName")), key=lambda r: r.get("id") or 0)
    chapters, names = content.load_chapters(loc_dir), content.load_unit_names(loc_dir)
    bosses = {u.get("id") for d in (tables.get("abnormality-unit") or {}).values()
              for u in (d.get("list") or []) if isinstance(d, dict) and isinstance(u, dict)}
    where = _where(tables, chapters, names, bosses)
    events = {r["fileName"].rsplit("/", 1)[-1]: round((r.get("duration") or 0) * 1000) for r in rows}
    for ev in where:
        events.setdefault(ev, None)
    found = _resolve(events, samples)
    tracks, by_sample, events_of = [], {}, {}  # events_of: {event: its track's number} (stages name events)

    def add(ev, name, by, battle):
        s, w = found.get(ev), where.get(ev) or {}
        if not s:
            return False
        t = by_sample.get(_norm(s[0]))
        if t:  # the same recording under another event: one track, which keeps the fights of both
            events_of[ev] = tracks.index(t)
            if w.get("waves") and not t["fights"]:
                t.update(where=w["label"], who=w["who"], fights=w["waves"], battle=True)
            return True
        t = by_sample[_norm(s[0])] = {"event": ev, "name": name, "by": by, "battle": battle, "bank": s[2], "i": s[3], "ms": s[1],
                                      "where": w.get("label") or "", "who": w.get("who") or [], "fights": w.get("waves") or 0}
        tracks.append(t)
        events_of[ev] = len(tracks) - 1
        return True

    missing = []
    for r in rows:
        ev, t = r["fileName"].rsplit("/", 1)[-1], loc.get(r.get("id")) or {}
        battle = "/Battle/" in r["fileName"] or ev in where
        if not add(ev, units._one_line(t.get("name")) or ev.replace("_", " "), units._one_line(t.get("songWriter")) or "", battle):
            missing.append(ev)
    listed = {r["fileName"].rsplit("/", 1)[-1] for r in rows}
    used = collections.Counter(t["name"] for t in tracks)
    for ev in sorted(set(where) - listed, key=lambda e: (where[e]["order"], e)):  # played in fights, not in the jukebox
        w = where[ev]
        song = next((t for t in tracks if t["event"] == INSTRUMENTAL.get(ev)), None)
        if song:
            if add(ev, song["name"] + " (instrumental)", song["by"], True):
                tracks[-1].update(where=song["where"], who=song["who"], fights=song["fights"])
            else:
                missing.append(ev)
            continue
        name = f"{w['who'][0] if w['who'] and w['waves'] <= BOSS_FIGHTS else w['label']} battle theme"
        used[name] += 1
        if not add(ev, name + (f" {used[name]}" if used[name] > 1 else ""), "", True):
            missing.append(ev)
    return {"tracks": tracks, "missing": missing, "events": events_of}


KEEP = 40  # tracks kept converted in data/music_cache (about 4 MB each)


def audio_file(svc, track: dict) -> tuple[str, str]:
    """(file, content type) of a track to play: its bank sample decoded by FMOD and packed as AAC once, so that the
    player can seek in it and a three-minute track isn't 35 MB of WAV on every request."""
    import hashlib
    import subprocess

    from .banks import export_wav
    from .viewer import ffmpeg_exe
    folder = os.path.join(svc.data_dir, "music_cache")
    os.makedirs(folder, exist_ok=True)
    key = hashlib.sha1(f"{track['bank']}|{track['i']}|{track['ms']}".encode()).hexdigest()[:16]
    for ext, ctype in ((".m4a", "audio/mp4"), (".wav", "audio/wav")):
        if os.path.exists(os.path.join(folder, key + ext)):
            os.utime(os.path.join(folder, key + ext))
            return os.path.join(folder, key + ext), ctype
    path = svc.real_path(track["bank"])
    if not path:
        raise FileNotFoundError("bank not found in the current install")
    wav, ff = export_wav(path, track["i"])[0], ffmpeg_exe()
    out, ctype = os.path.join(folder, key + ".wav"), "audio/wav"
    tmp = out + ".tmp"
    with open(tmp, "wb") as f:
        f.write(wav)
    if ff:
        try:
            m4a = os.path.join(folder, key + ".m4a")
            subprocess.run([ff, "-v", "error", "-y", "-i", tmp, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
                            "-f", "mp4", m4a + ".tmp"], check=True, capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            os.replace(m4a + ".tmp", m4a)
            os.remove(tmp)
            out, ctype, tmp = m4a, "audio/mp4", None
        except Exception:
            pass  # no encoder: the WAV plays too
    if tmp:
        os.replace(tmp, out)
    files = sorted((os.path.join(folder, fn) for fn in os.listdir(folder)), key=os.path.getmtime, reverse=True)
    for old in files[KEEP:]:
        try:
            os.remove(old)
        except OSError:
            pass
    return out, ctype
