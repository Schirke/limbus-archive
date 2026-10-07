"""Compare two snapshots and build a patch report.

Every change ends up in some section — categories only group things, unknown kinds go to "other".
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict

from .store import Store

LEAK_RE = re.compile(r"nextupdate|notinclude|donottranslate|do_not_translate", re.I)
SUSPICIOUS_RE = re.compile(r"dummy|(^|[_\-/ .])test|test([_\-/ .]|$)|unused|(^|[_\-/])temp([_\-/.]|$)|\bwip\b|placeholder", re.I)
LOC_RE = re.compile(r"^install/LimbusCompany_Data/Assets/Resources_moved/Localize/(?:(en|kr|jp)/)?(.*?)(EN|KR|JP)_([^/]+)$")
CJK_RE = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
MAX_RECORDS = 400

IMAGE_TYPES = {"Texture2D", "Sprite"}
# parts of prefabs ("Dummy" attach points, "[Image]Sample" UI nodes…): never news by themselves
STRUCTURAL_TYPES = {"GameObject", "Transform", "RectTransform", "MonoBehaviour", "Mesh", "Material", "Shader",
                    "MonoScript", "CanvasRenderer", "SpriteRenderer", "MeshRenderer", "MeshFilter", "Animator",
                    "AnimatorController", "Avatar", "ParticleSystem", "ParticleSystemRenderer", "PlayableDirector"}
AUDIO_EXT = {".bank", ".wav", ".ogg", ".mp3", ".fsb"}
VIDEO_EXT = {".mp4", ".usm", ".webm"}
CODE_FILES = re.compile(r"(GameAssembly\.dll|global-metadata\.dat|\.dll)$", re.I)


# ---------------------------------------------------------------- json records
def parse_records(data: bytes | None):
    """Return (records_by_id, raw_obj) for a JSON document shaped like {"dataList": [{id:..}, ...]}."""
    if data is None:
        return None, None
    try:
        obj = json.loads(data.decode("utf-8-sig"))
    except Exception:
        return None, None
    lst = None
    if isinstance(obj, list):
        lst = obj
    elif isinstance(obj, dict):
        lists = [v for v in obj.values() if isinstance(v, list) and (not v or isinstance(v[0], dict))]
        if len(lists) == 1:
            lst = lists[0]
    if lst is None or any(not isinstance(r, dict) for r in lst):
        return None, obj
    out = {}
    for i, r in enumerate(lst):
        rid = r.get("id", r.get("ID", r.get("key", f"#{i}")))
        rid = json.dumps(rid, ensure_ascii=False) if not isinstance(rid, str) else rid
        while rid in out:
            rid += "'"
        out[rid] = r
    return out, obj


def record_has_text(r: dict) -> bool:
    for k, v in r.items():
        if k.lower() in ("id", "key"):
            continue
        if isinstance(v, str) and v.strip():
            return True
        if isinstance(v, (list, dict)) and v:
            return True
    return False


def diff_records(old: dict, new: dict) -> dict:
    added = [new[k] for k in new if k not in old]
    removed = [old[k] for k in old if k not in new]
    changed = []
    for k in new:
        if k in old and old[k] != new[k]:
            fields = {}
            for f in set(old[k]) | set(new[k]):
                a, b = old[k].get(f), new[k].get(f)
                if a != b:
                    fields[f] = [a, b]
            changed.append({"id": k, "fields": fields, "record": new[k]})
    res = {"added": added[:MAX_RECORDS], "removed": removed[:MAX_RECORDS], "changed": changed[:MAX_RECORDS],
           "counts": {"added": len(added), "removed": len(removed), "changed": len(changed)}}
    return res


def text_lines_diff(a: bytes | None, b: bytes | None, limit=300) -> list[str]:
    import difflib
    sa = (a or b"").decode("utf-8", "replace").splitlines()
    sb = (b or b"").decode("utf-8", "replace").splitlines()
    out = list(difflib.unified_diff(sa, sb, "old", "new", n=1, lineterm=""))
    return out[:limit] + ([f"... {len(out) - limit} more lines"] if len(out) > limit else [])


# ---------------------------------------------------------------- objects
def _object_maps(store: Store, snap: dict, logicals: set[str]) -> dict[str, dict]:
    out = {}
    for logical in logicals:
        b = snap["bundles"].get(logical)
        if not b or not b.get("index"):
            continue
        idx = store.read_json(b["index"]) or {"objects": []}
        for o in idx["objects"]:
            if "c" in o:
                key = f"c:{o['c']}|{o['type']}|{o.get('name', '')}"
            else:
                key = f"b:{logical}|{o['type']}|{o.get('name', '')}|{o['pid']}"
            while key in out:
                key += f"#{o['pid']}"
            o = dict(o)
            o["bundle"] = logical
            o["pid"] = str(o["pid"])  # 64-bit path ids don't survive JavaScript numbers
            o.pop("tex_pid", None)
            out[key] = o
    return out


def _flags(*texts: str | None) -> list[str]:
    s = " ".join(t for t in texts if t)
    flags = []
    if LEAK_RE.search(s):
        flags.append("leak")
    elif SUSPICIOUS_RE.search(s):
        flags.append("suspicious")
    return flags


SPINE_JSON_RE = re.compile(rb'^\s*\{\s*"skeleton"\s*:')


def _not_text(data: bytes | None) -> bool:
    if not data:
        return False
    if SPINE_JSON_RE.match(data[:64]):
        return True
    head = data[:4096]
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as e:
        if e.start < len(head) - 3:  # not just a character cut in half at the end of the sample
            return True
    return b"\x00" in head


def _section_for_object(o: dict) -> str:
    t = o["type"]
    if t in IMAGE_TYPES:
        return "images"
    if t == "TextAsset":
        name = (o.get("name") or o.get("c") or "").lower()
        if name.endswith((".atlas", ".skel", ".bytes")) or "spine" in o.get("c", "").lower():
            return "other"  # Spine animation data, not readable text
        return "data" if "/StaticData/" in o.get("c", "") else "texts"
    if t == "AudioClip":
        return "audio"
    if t == "VideoClip":
        return "video"
    return "other"


def _section_for_file(rel: str) -> str:
    ext = os.path.splitext(rel)[1].lower()
    if LOC_RE.match(rel):
        return "texts"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    if CODE_FILES.search(rel):
        return "code"
    if ext in {".png", ".jpg", ".jpeg", ".webp"}:
        return "images"
    if ext in {".json", ".txt", ".csv", ".xml"}:
        return "data"
    return "other"


# ---------------------------------------------------------------- localization leaks
def loc_base(rel: str) -> str | None:
    m = LOC_RE.match(rel)
    return m.group(2) + m.group(4) if m else None


def localization_index(store: Store, snap: dict, only: set[str] | None = None) -> dict[str, dict[str, dict]]:
    """{base_name: {lang: {record_id: record}}} for the localization files in the snapshot."""
    out: dict[str, dict[str, dict]] = defaultdict(dict)
    for rel, f in snap["files"].items():
        m = LOC_RE.match(rel)
        if not m or not f.get("blob"):
            continue
        lang = m.group(3).lower()
        base = m.group(2) + m.group(4)
        if only is not None and base not in only:
            continue
        recs, _ = parse_records(store.get_blob(f["blob"]))
        if recs is not None:
            out[base][lang] = recs
    return out


def foreign_only_records(loc: dict) -> dict[str, list]:
    """Records with real text that exist in KR or JP but not in EN: {base: [{"id", "lang", "record"}]}."""
    out = {}
    for base, langs in loc.items():
        en = langs.get("en", {})
        found = []
        for lang in ("kr", "jp"):
            for rid, r in langs.get(lang, {}).items():
                if rid not in en and record_has_text(r):
                    found.append({"id": rid, "lang": lang, "record": r})
        if found:
            out[base] = found
    return out


# ---------------------------------------------------------------- main
def diff_snapshots(store: Store, old_id: str, new_id: str) -> dict:
    old = store.read_json(f"snapshots/{old_id}.json.gz")
    new = store.read_json(f"snapshots/{new_id}.json.gz")
    if not old or not new:
        raise FileNotFoundError("snapshot not found")
    sections = {k: [] for k in ("leaks", "texts", "data", "images", "audio", "video", "code", "other")}

    # ---- bundles → objects
    ob, nb = old["bundles"], new["bundles"]
    affected = {k for k in set(ob) | set(nb) if ob.get(k, {}).get("hash") != nb.get(k, {}).get("hash")}
    om, nm = _object_maps(store, old, affected), _object_maps(store, new, affected)
    # objects with a path in the game (UI art, story, gacha…) first; nameless parts of effects and maps after
    for key in sorted(set(om) | set(nm), key=lambda k: (not k.startswith("c:"), k)):
        o, n = om.get(key), nm.get(key)
        if o and n and o.get("h") == n.get("h"):
            continue
        kind = "added" if not o else "removed" if not n else "changed"
        cur = n or o
        item = {"kind": kind, "type": cur["type"], "name": cur.get("name"), "path": cur.get("c"),
                "bundle": cur["bundle"], "pid": cur["pid"], "old": o, "new": n,
                "flags": _flags(cur.get("c"), cur.get("name"), cur["bundle"])}
        sec = _section_for_object(cur)
        if cur["type"] == "TextAsset":
            ob_ = store.get_blob(o["h"]) if o else None
            nb_ = store.get_blob(n["h"]) if n else None
            ro, _ = parse_records(ob_)
            rn, _ = parse_records(nb_)
            if ro is not None or rn is not None:
                item["records"] = diff_records(ro or {}, rn or {})
            elif _not_text(nb_ or ob_):
                sec = "other"  # Spine skeletons (JSON) and binary blobs are not texts to read
            else:
                item["lines"] = text_lines_diff(ob_, nb_)
        sections[sec].append(item)

    # an image with a path comes as a Texture2D plus a Sprite cut from it: show it once
    tex_paths = {(it["kind"], it["path"]) for it in sections["images"] if it["type"] == "Texture2D" and it["path"]}
    sections["images"] = [it for it in sections["images"]
                          if not (it["type"] == "Sprite" and it["path"] and (it["kind"], it["path"]) in tex_paths)]

    # ---- bundles themselves (for the "other" overview)
    bundle_changes = []
    for k in sorted(affected):
        kind = "added" if k not in ob else "removed" if k not in nb else "changed"
        bundle_changes.append({"kind": kind, "bundle": k, "size": (nb.get(k) or ob.get(k)).get("size")})

    # ---- files
    of, nf = old["files"], new["files"]
    for rel in sorted(set(of) | set(nf)):
        o, n = of.get(rel), nf.get(rel)
        if o and n and o.get("h") == n.get("h"):
            continue
        kind = "added" if not o else "removed" if not n else "changed"
        item = {"kind": kind, "type": "file", "path": rel, "name": rel.rsplit("/", 1)[-1], "old": o, "new": n,
                "flags": _flags(rel)}
        if (o or {}).get("names") and (n or {}).get("names"):
            on = set((store.get_blob(o["names"]) or b"").decode("ascii", "replace").split("\n"))
            nn = set((store.get_blob(n["names"]) or b"").decode("ascii", "replace").split("\n"))
            added, removed = sorted(nn - on), sorted(on - nn)
            item["names"] = {"added": added[:5000], "removed": removed[:5000],
                             "counts": {"added": len(added), "removed": len(removed)}}
        if (o or {}).get("sounds") is not None or (n or {}).get("sounds") is not None:
            os_ = {s[0]: s[1] for s in (o or {}).get("sounds") or []}
            ns_ = {s[0]: s[1] for s in (n or {}).get("sounds") or []}
            names = [s[0] for s in (n or {}).get("sounds") or []]
            item["sounds"] = {
                "added": [[nm, ns_[nm], names.index(nm)] for nm in ns_ if nm not in os_],
                "changed": [[nm, ns_[nm], names.index(nm)] for nm in ns_ if nm in os_ and os_[nm] != ns_[nm]],
                "removed": [[nm, os_[nm]] for nm in os_ if nm not in ns_],
                "total": len(ns_),
            }
            item["flags"] = item["flags"] or _flags(*ns_.keys())
        if (o or {}).get("blob") or (n or {}).get("blob"):
            ob_ = store.get_blob(o["blob"]) if o and o.get("blob") else None
            nb_ = store.get_blob(n["blob"]) if n and n.get("blob") else None
            ro, _ = parse_records(ob_)
            rn, _ = parse_records(nb_)
            if ro is not None or rn is not None:
                item["records"] = diff_records(ro or {}, rn or {})
                m = LOC_RE.match(rel)
                if m:
                    item["lang"] = m.group(3).lower()
            else:
                item["lines"] = text_lines_diff(ob_, nb_)
        sections[_section_for_file(rel)].append(item)

    # ---- catalog paths
    oa, na = old["assets"], new["assets"]
    catalog = {
        "added": [{"path": p, "types": na[p]["types"], "bundle": na[p]["bundle"], "flags": _flags(p)}
                  for p in sorted(set(na) - set(oa))],
        "removed": [{"path": p, "types": oa[p]["types"], "bundle": oa[p]["bundle"]} for p in sorted(set(oa) - set(na))],
    }

    # ---- leaks: flagged names + new KR/JP-only localization records
    for sec in ("texts", "data", "images", "audio", "video", "code", "other"):
        for it in sections[sec]:
            if it.get("type") in STRUCTURAL_TYPES and not it.get("path") and "leak" not in it["flags"]:
                continue
            if "leak" in it["flags"] or "suspicious" in it["flags"]:
                sections["leaks"].append({**{k: it[k] for k in ("kind", "type", "name", "path", "flags", "pid") if k in it},
                                          "section": sec, "bundle": it.get("bundle")})
    for c in catalog["added"]:
        if c["flags"]:
            sections["leaks"].append({"kind": "added", "type": "/".join(c["types"]), "path": c["path"],
                                      "name": c["path"].rsplit("/", 1)[-1], "flags": c["flags"], "section": "catalog"})
    changed_bases = {loc_base(rel) for rel in set(of) | set(nf)
                     if (of.get(rel) or {}).get("h") != (nf.get(rel) or {}).get("h")} - {None}
    old_foreign = foreign_only_records(localization_index(store, old, changed_bases))
    new_foreign = foreign_only_records(localization_index(store, new, changed_bases))
    foreign = []
    for base, recs in new_foreign.items():
        before = {(r["id"], r["lang"]) for r in old_foreign.get(base, [])}
        fresh = [r for r in recs if (r["id"], r["lang"]) not in before]
        if fresh:
            foreign.append({"file": base, "records": fresh[:MAX_RECORDS], "count": len(fresh)})

    summary = {k: len(v) for k, v in sections.items()}
    summary["foreign_only"] = sum(f["count"] for f in foreign)
    summary["catalog_added"] = len(catalog["added"])
    summary["catalog_removed"] = len(catalog["removed"])
    summary["bundles_changed"] = len(bundle_changes)
    other_by_type = Counter(f"{it['kind']} {it['type']}" for it in sections["other"])

    report = {
        "id": f"{old_id}__{new_id}",
        "old": {"id": old_id, "version": old.get("version"), "created": old.get("created")},
        "new": {"id": new_id, "version": new.get("version"), "created": new.get("created")},
        "summary": summary,
        "sections": sections,
        "foreign_only": foreign,
        "catalog": catalog,
        "bundles": bundle_changes,
        "other_by_type": other_by_type.most_common(),
    }
    store.write_json(f"reports/{report['id']}.json.gz", report)
    meta = {k: report[k] for k in ("id", "old", "new", "summary")}
    with open(os.path.join(store.root, "reports", report["id"] + ".meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    return report


def scan_snapshot(store: Store, snap_id: str) -> dict:
    """Leak scan of a single snapshot (no comparison): flagged names and KR/JP-only records."""
    snap = store.read_json(f"snapshots/{snap_id}.json.gz")
    flagged = [{"path": p, "types": a["types"], "bundle": a["bundle"], "flags": _flags(p)}
               for p, a in snap["assets"].items() if _flags(p)]
    flagged += [{"path": rel, "types": ["file"], "flags": _flags(rel)} for rel in snap["files"] if _flags(rel)]
    foreign = [{"file": b, "records": r[:MAX_RECORDS], "count": len(r)}
               for b, r in foreign_only_records(localization_index(store, snap)).items()]
    return {"id": snap_id, "flagged": flagged, "foreign_only": foreign}
