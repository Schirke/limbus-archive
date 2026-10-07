"""AI redraw (experimental, only where ComfyUI is set up): a skill's frames zip (Animations -> Edit -> Frames) is
redrawn as another character by ComfyUI_windows_portable/redraw.py — same poses, sizes and file names — into a new zip
in data/exports, which can then be loaded into a mod. The page shows only when that script and uv are found."""
import glob, io, json, os, re, shutil, subprocess, threading, time, zipfile

COMFY = os.environ.get("LIMBUS_COMFY", r"C:\claude-apps\ComfyUI_windows_portable")
SCRIPT = os.path.join(COMFY, "redraw.py")
PKGS = ["rembg[gpu]", "ultralytics", "pillow", "requests"]

_lock = threading.Lock()
_state = {"running": False, "log": [], "done": 0, "total": 0, "out": None, "error": None, "started": 0}
_proc = None


def available() -> bool:
    return os.path.isfile(SCRIPT) and bool(shutil.which("uv"))


def _exports(svc) -> str:
    return os.path.join(svc.data_dir, "exports")


def _zip_path(svc, name: str) -> str:
    p = os.path.normpath(os.path.join(_exports(svc), os.path.basename(name)))
    if not p.lower().endswith(".zip") or not os.path.isfile(p):
        raise FileNotFoundError(name)
    return p


def zips(svc) -> list[dict]:
    """Frames zips in data/exports, newest first; `ai` = made here."""
    out = []
    for p in glob.glob(os.path.join(_exports(svc), "*frames*.zip")):
        try:
            with zipfile.ZipFile(p) as z:
                pngs = sorted(n for n in z.namelist() if n.lower().endswith(".png"))
        except zipfile.BadZipFile:
            continue
        n = os.path.basename(p)
        out.append({"name": n, "frames": pngs, "ai": "[AI " in n, "time": os.path.getmtime(p)})
    return sorted(out, key=lambda x: -x["time"])


def state() -> dict:
    with _lock:
        st = dict(_state, log=_state["log"][-12:], available=available())
    # the frames done so far (the script saves each one in the work folder as it's ready), in the order made
    w = st.get("work")
    st["fresh"] = sorted((f for f in os.listdir(w) if f.lower().endswith(".png")),
                         key=lambda f: os.path.getmtime(os.path.join(w, f))) if w and os.path.isdir(w) else []
    return st


def start(svc, b: dict) -> dict:
    """A run over a frames zip; b["resume"]: go on with the run stopped last, from the frames not done yet (same
    settings — the frames already made stay in the work folder)."""
    global _proc
    if _state["running"]:
        raise RuntimeError("already running")
    resume = bool(b.get("resume"))
    if resume:
        if not _state.get("params"):
            raise RuntimeError("nothing to go on with")
        b = _state["params"]
    src = _zip_path(svc, b["zip"])
    char = (b.get("char") or "").strip()
    if not char:
        raise ValueError("character tags are empty")
    seed = int(b.get("seed") or 12345)
    label = re.sub(r"[^\w' -]", "", re.sub(r"_\(.*|\s*\\\(.*", "", char.split(",")[0])).strip()[:30] or "char"
    stem = re.sub(r"\.zip$", "", os.path.basename(src), flags=re.I)
    dst = os.path.join(_exports(svc), f"{stem} [AI {label} s{seed}].zip")
    with zipfile.ZipFile(src) as zf:
        frames = [n for n in zf.namelist() if n.lower().endswith(".png")]
    only = [n for n in (b.get("only") or []) if n in frames]
    frames = only or frames
    work = os.path.join(svc.data_dir, "redraw_work")  # the frames as they're done; emptied for each new run
    if not resume:
        shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    made = set(os.listdir(work))
    todo = [n for n in frames if n not in made]
    with _lock:
        _state.update(running=True, log=[], done=len(frames) - len(todo), offset=len(frames) - len(todo),
                      total=len(frames), out=None, error=None, started=time.time(), work=work,
                      src=os.path.basename(src), params=dict(b, resume=False))
    if not todo:  # all made before the stop: only the zip is left to write
        _pack(src, work, dst)
        with _lock:
            _state.update(running=False, out=os.path.basename(dst))
        return state()
    args = ["uv", "run", "--no-project"] + [x for p in PKGS for x in ("--with", p)] + [
        SCRIPT, src, dst, "--work", work, "--char", char, "--seed", str(seed), "--only", ";".join(todo),
        "--denoise", str(float(b.get("denoise", 0.85))), "--cn", str(float(b.get("cn", 0.7))),
        "--face", str(float(b.get("face", 0.45)))]
    if (b.get("avoid") or "").strip():
        args += ["--not", b["avoid"].strip()]
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    _proc = subprocess.Popen(args, cwd=COMFY, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    threading.Thread(target=_watch, args=(_proc, dst), daemon=True).start()
    return state()


def _pack(src: str, work: str, dst: str):
    """The redrawn frames + the source zip's notes, as the script writes it at the end of a run."""
    with zipfile.ZipFile(src) as zs, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n in sorted(os.listdir(work)):
            z.write(os.path.join(work, n), n)
        for n in zs.namelist():
            if not n.lower().endswith(".png"):
                z.writestr(n, zs.read(n))


def _watch(proc, dst):
    for raw in proc.stdout:
        line = raw.decode("utf-8", "replace").rstrip()
        if not line or "\x00" in line or "Warning" in line or "onnxruntime" in line or line.startswith(("  warnings.", "Downloading", "Installed", "Resolved",
                                                              "Prepared", "Built", "Audited")):
            continue
        with _lock:
            _state["log"].append(line[-300:])
            m = re.match(r"\[(\d+)/(\d+)\]", line)
            if m:
                _state["done"] = _state.get("offset", 0) + int(m.group(1))
    code = proc.wait()
    with _lock:
        _state["running"] = False
        if code == 0 and os.path.isfile(dst):
            _state["out"] = os.path.basename(dst)
        elif _state.get("stopped"):
            _state["error"] = "stopped"
        else:
            _state["error"] = _state["log"][-1] if _state["log"] else f"exit code {code}"
        _state.pop("stopped", None)


def stop() -> dict:
    """The whole tree goes: uv, the script and the ComfyUI it started (the GPU is freed)."""
    if _proc and _proc.poll() is None:
        with _lock:
            _state["stopped"] = True
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(_proc.pid)], capture_output=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        # ComfyUI started by an earlier run of the script may still hold the port
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine "
                        "-like '*ComfyUI*main.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
                       capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return state()


def thumb(svc, name: str, frame: str, size: int = 260) -> bytes:
    """One frame of a zip (name "@work": of the run going on), cropped to the figure, as a small PNG."""
    from PIL import Image
    if name == "@work":
        im = Image.open(os.path.join(svc.data_dir, "redraw_work", os.path.basename(frame))).convert("RGBA")
    else:
        with zipfile.ZipFile(_zip_path(svc, name)) as z:
            im = Image.open(io.BytesIO(z.read(frame))).convert("RGBA")
    bb = im.split()[3].getbbox()
    if bb:
        im = im.crop(bb)
    im.thumbnail((size, size))
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


# Danbooru (open API, no key): the model learned characters by their danbooru tag, so the tags come from there
BOORU = "https://danbooru.donmai.us"
# general tags that describe looks (the related-tags list also has "1girl", "smile", "simple_background"…)
LOOKS = re.compile(r"hair|eyes|ears|horns?$|tail|wings?$|halo|dress|coat|jacket|shirt|shorts|skirt|pants|gloves|boots|hat$|"
                   r"hood|cape|scarf|ribbon|bow$|choker|armor|uniform|sleeves|thighhighs|pantyhose|legwear|necktie|eyewear|"
                   r"glasses|mask|crown|bangs|ahoge|ponytail|twintails|braid|bun|hairband|hairclip|headwear|earrings|collar|"
                   r"belt|vest|sweater|hoodie|kimono|apron|bodysuit|leotard|stethoscope|crop_top|antenna|skin|freckles|scar")
NOT_PORTRAIT = {"comic", "4koma", "meme", "parody", "multiple_views", "multiple_girls", "multiple_boys", "everyone",
                "text_focus", "chibi", "cosplay", "reference_sheet", "translated", "english_text", "speech_bubble"}
LENGTHS = ("short_hair", "medium_hair", "long_hair", "very_long_hair", "absurdly_long_hair")


def _get(url: str) -> tuple[bytes, str]:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "LimbusArchive"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(), r.headers.get("Content-Type", "")


def _booru(path: str, params: dict):
    from urllib.parse import urlencode
    return json.loads(_get(BOORU + path + "?" + urlencode(params))[0])


def _prompt(tag: str) -> str:
    """A danbooru tag as the model read it in training: spaces, and brackets escaped (ComfyUI takes "(x)" as weight)."""
    return tag.replace("_", " ").replace("(", r"\(").replace(")", r"\)")


def search(q: str) -> list[dict]:
    """Character tags for a typed name ("wis'adel", "kaltsit"): danbooru's autocomplete (knows aliases) + a name match."""
    q = q.strip().lower()
    if not q:
        return []
    found = {}
    for t in _booru("/autocomplete.json", {"search[query]": q, "search[type]": "tag_query", "limit": 20}):
        if t.get("category") == 4:
            found[t["value"]] = t.get("post_count", 0)
    for t in _booru("/tags.json", {"search[name_matches]": "*" + q.replace(" ", "_") + "*", "search[category]": 4,
                                   "search[order]": "count", "limit": 10}):
        found[t["name"]] = t["post_count"]
    if not found:  # typed without the apostrophe / spaces ("kaltsit" for kal'tsit): letters in order, then kept
        flat = re.sub(r"[^a-z0-9]", "", q)  # only where they stand together
        for t in _booru("/tags.json", {"search[name_matches]": "*" + "*".join(flat) + "*", "search[category]": 4,
                                       "search[order]": "count", "limit": 50}):
            if flat in re.sub(r"[^a-z0-9]", "", t["name"]):
                found[t["name"]] = t["post_count"]
    return [{"tag": k, "count": v} for k, v in sorted(found.items(), key=lambda x: -x[1]) if v][:12]


def character(tag: str) -> dict:
    """The tags to type for a character (its own tag + the looks most of its pictures share) and a few pictures."""
    rel = _booru("/related_tag.json", {"query": tag, "category": "general", "limit": 60}).get("related_tags") or []
    looks, length = [], None
    for r in rel:
        n, f = r["tag"]["name"], r.get("frequency", 0)
        if f < 0.2 or not LOOKS.search(n):
            continue
        if n in LENGTHS:  # one hair length, the most common
            if length:
                continue
            length = n
        looks.append(n)
    # pictures of her alone, the best liked: without an account a search takes two tags (rating: is free, order: isn't),
    # so the newest 100 solo ones are sorted here, comics / memes / crowds left out
    posts = _booru("/posts.json", {"tags": f"{tag} solo rating:g", "limit": 100})
    posts = sorted((p for p in posts if not NOT_PORTRAIT & set(p.get("tag_string", "").split())),
                   key=lambda p: -p.get("score", 0))[:4]
    pics = []
    for p in posts:  # a 360 px version when there is one (the preview is 150 px)
        v = {x.get("type"): x.get("url") for x in (p.get("media_asset") or {}).get("variants") or []}
        pics.append(v.get("360x360") or p.get("preview_file_url"))
    return {"tags": ", ".join(_prompt(t) for t in [tag] + looks[:14]), "pics": [u for u in pics if u]}


def booru_image(url: str) -> tuple[bytes, str]:
    """A danbooru picture through the app (the window doesn't load it straight)."""
    if not re.match(r"https://cdn\.donmai\.us/", url):
        raise ValueError("not a danbooru picture")
    data, ctype = _get(url)
    return data, ctype or "image/jpeg"


def load(svc, name: str, mod: str) -> tuple[int | str, int]:
    """A redrawn zip into a mod of the character the zip is for ("10315 - …")."""
    from . import mods
    p = _zip_path(svc, name)
    m = re.match(r"(\d+|[\w .()-]+Appearance) - ", os.path.basename(p))
    if not m:
        raise ValueError("the zip's name doesn't start with the character id")
    cid = int(m.group(1)) if m.group(1).isdigit() else m.group(1)
    with open(p, "rb") as f:
        return cid, mods.put_frames_zip(svc, cid, mod, f.read())
