import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "check")
sys.path.insert(0, ROOT)

VOLATILE = {"/api/state", "/api/appnotes", "/api/community", "/api/community_rec", "/api/bilibili", "/api/news",
            "/api/versus_live", "/api/versus_list", "/api/stage_pics", "/api/fighter_pics", "/api/buffs", "/api/fx",
            "/api/site_status", "/api/ui_lang/status", "/api/enemies", "/api/sprites", "/api/mods_owned", "/api/game_cards"}
QUIET = {"/api/state", "/api/community", "/api/versus_live", "/api/fx", "/api/buffs", "/api/stage_pics", "/api/fighter_pics"}


def py_files():
    dirs = [os.path.join(ROOT, "limbusdm"), os.path.join(ROOT, "scripts"), os.path.join(ROOT, "unity", "LimbusViewer", "Python")]
    return [os.path.join(d, f) for d in dirs if os.path.isdir(d) for f in sorted(os.listdir(d)) if f.endswith(".py")]


def js_files():
    out = []
    for d, _, fs in os.walk(os.path.join(ROOT, "ui")):
        if os.sep + "extra" in d:
            continue
        out += [os.path.join(d, f) for f in sorted(fs) if f.endswith(".js")]
    return out


def page_scripts():
    import re
    with open(os.path.join(ROOT, "ui", "index.html"), encoding="utf-8") as f:
        html = f.read()
    return [os.path.join(ROOT, "ui", s) for s in re.findall(r'<script src="/ui/([^"?]+)', html)]


def top_names(path):
    import re
    names = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"(?:async\s+)?function\s*\*?\s*([\w$]+)|(const|let|class|var)\s+([\w$]+)", line)
            if m:
                names.append((m.group(1) or m.group(3), "function" if m.group(1) else m.group(2)))
    return names


def check_code(rep):
    import py_compile
    for f in py_files():
        try:
            py_compile.compile(f, doraise=True, cfile=os.path.join(tempfile.gettempdir(), "limbus-check.pyc"))
        except py_compile.PyCompileError as e:
            rep.fail("code", os.path.relpath(f, ROOT), str(e.msg).strip().splitlines()[-1])
    node = shutil.which("node")
    if not node:
        rep.warn("code", "node", "not found: JS not checked")
    else:
        for f in js_files():
            src = f
            if open(f, encoding="utf-8").read().lstrip().startswith(("export", "import")) or f.endswith("worker.js"):
                src = os.path.join(tempfile.gettempdir(), "limbus-check-" + os.path.basename(f)[:-3] + ".mjs")
                shutil.copyfile(f, src)
            r = subprocess.run([node, "--check", src], capture_output=True, text=True, encoding="utf-8", errors="replace")
            if r.returncode:
                msg = [x for x in r.stderr.splitlines() if x.strip()]
                rep.fail("code", os.path.relpath(f, ROOT), " | ".join(msg[:4]))
    seen = {}
    for f in page_scripts():
        if not os.path.exists(f):
            rep.fail("code", "ui/index.html", f"script missing: {os.path.relpath(f, ROOT)}")
            continue
        for name, kind in top_names(f):
            if name in seen:
                first, fkind = seen[name]
                where = f"{name}: {os.path.relpath(first, ROOT)} and {os.path.relpath(f, ROOT)}"
                if kind in ("const", "let", "class") or fkind in ("const", "let", "class"):
                    rep.fail("code", "global scope", where)
                elif first != f:
                    rep.warn("code", "global scope", "function declared twice, the later wins: " + where)
            else:
                seen[name] = (f, kind)


class Report:
    def __init__(self):
        self.items, self.answers, self.tracebacks = [], {}, []

    def fail(self, part, what, msg):
        self.items.append({"level": "FAIL", "part": part, "what": what, "msg": msg})

    def warn(self, part, what, msg):
        self.items.append({"level": "warn", "part": part, "what": what, "msg": msg})


def start_server(rep):
    from limbusdm import paths, server
    from limbusdm.service import Service

    real_popen = subprocess.Popen

    class Guard(real_popen):
        def __init__(self, args, *a, **k):
            s = args if isinstance(args, str) else " ".join(map(str, args))
            if "LimbusViewer" in s:
                raise RuntimeError("check: the player is not started")
            super().__init__(args, *a, **k)
    subprocess.Popen = Guard
    try:
        from limbusdm import viewer
        viewer.viewer_exe = lambda: None
        status = viewer.PicQueue.status
        viewer.PicQueue.status = lambda self, names=None, known=None: status(self, None, known)
    except Exception:
        pass

    local = threading.local()

    class TB:
        def __getattr__(self, k):
            return getattr(traceback, k)

        def print_exc(self, *a, **k):
            if not isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
                rep.tracebacks.append({"path": getattr(local, "path", "?"), "tb": traceback.format_exc()})
    server.traceback = TB()

    svc = Service(paths.data_dir())
    base = server.make_handler(svc, os.path.join(ROOT, "ui"))

    class H(base):
        def _run(self, fn):
            local.path = self.path
            super()._run(fn)

        def do_POST(self):
            self.close_connection = True
            self._json({"error": "check: read only"}, 403)

    class Server(ThreadingHTTPServer):
        request_queue_size = 128  # a page opens its connections in one burst; 5 refuses some of them on Windows

    httpd = Server(("127.0.0.1", 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def get(base, path, timeout=180):
    t = time.time()
    try:
        with urlopen(Request(base + path, headers={"User-Agent": "limbus-check"}), timeout=timeout) as r:
            body, code, ctype = r.read(), r.status, r.headers.get("Content-Type", "")
            if r.headers.get("Content-Encoding") == "gzip":
                import gzip
                body = gzip.decompress(body)
    except HTTPError as e:
        body, code, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
    except Exception as e:
        return {"code": 0, "error": f"{type(e).__name__}: {e}", "ms": int((time.time() - t) * 1000)}
    out = {"code": code, "ms": int((time.time() - t) * 1000), "size": len(body), "sha": hashlib.sha1(body).hexdigest()[:16]}
    if "json" in ctype:
        try:
            out["json"] = json.loads(body)
        except ValueError:
            out["error"] = "bad JSON"
    elif code >= 400:
        out["error"] = body[:200].decode("utf-8", "replace")
    return out


def first(xs, pred=lambda x: True):
    return next((x for x in xs if pred(x)), None)


def walk(obj, pred, n=1):
    found, stack = [], [obj]
    while stack and len(found) < n:
        o = stack.pop(0)
        if isinstance(o, dict):
            if pred(o):
                found.append(o)
            stack += list(o.values())
        elif isinstance(o, list):
            stack += o
    return found


def api_plan(g):
    units = g("/api/units") or {}
    ident = first(units.get("ids") or []) or {}
    ego = first(units.get("egos") or []) or {}
    iid, eid = ident.get("id", 10101), ego.get("id", 20101)
    iid2 = (first(units.get("ids") or [], lambda u: u.get("sinner") != ident.get("sinner")) or {}).get("id", 10201)
    state = g("/api/state") or {}
    rep_id = (first(state.get("reports") or []) or {}).get("id")
    enemies = (g("/api/enemies") or {}).get("list") or []
    en = first(enemies, lambda e: e.get("app")) or {}
    chars = g("/api/characters") or {}
    sp = first(g("/api/spine_list") or []) or {}
    clip = first(g(f"/api/owner_clips?id={iid}") or [], lambda c: c.get("animator_go")) or {}
    story = g("/api/story") or {}
    ep = (walk(story, lambda d: isinstance(d.get("story"), str)) or [{}])[0].get("story")
    music = g("/api/music") or []
    line = first((g("/api/quiz") or {}).get("ids") or [])
    bvid = first((g("/api/buffs?status=1") or {}).get("have") or [])
    node = (walk(g("/api/stages") or {}, lambda d: d.get("kind") == "fight" and "n" in d) or [{}])[0].get("id")
    langs = g("/api/langs") or {}
    lang = (walk(langs, lambda d: isinstance(d.get("id"), str) and d.get("id") != "en") or [{}])[0].get("id")
    thumb = (ident.get("img") or {}).get("thumb")
    art = (ident.get("img") or {}).get("art")
    plan = [
        "/api/appnotes", "/api/appnotes?all=1", "/api/types", "/api/marks", "/api/myteam", "/api/mirror", "/api/history",
        "/api/gacha", "/api/game_pics", "/api/announcers", "/api/game_cards", "/api/music", "/api/sounds", "/api/sounds?q=yi%20sang",
        "/api/langs", "/api/ui_langs", "/api/ui_lang/status", "/api/ui_lang?lang=ru", "/api/site_status", "/api/sprites",
        "/api/mods_owned", "/api/battle_maps", "/api/bgm_tracks", "/api/stage_pics", "/api/fighter_pics",
        "/api/versus_list", "/api/versus_live", "/api/versus_team_rules", f"/api/versus_tags?ids={iid}",
        f"/api/versus_plan?left={iid}&right={iid2}&seed=1&rounds=3", "/api/mirror/catalog", "/api/community",
        "/api/community_rec", "/api/bilibili?period=week&sort=views", "/api/news", "/api/browse?q=bgmCover&limit=5",
        "/api/tree?prefix=Assets/Resources_moved/Sprite/", "/api/buffs?status=1", "/api/stages", "/api/story", "/api/story_lines",
        "/api/quiz", f"/api/skill_slots?id={iid}", f"/api/fx?id={iid}", f"/api/fx_buffs?id={iid}",
        f"/api/mods?id={iid}&light=1", f"/api/skills?id={iid}", f"/api/owner_videos?id={iid}",
        f"/api/char_icon?id={iid}", f"/api/char_icon?id={eid}", "/api/ui_icon?k=sinner_1", "/api/gacha_ui?n=icon_lunacy",
        "/api/patchnotes?new=1", f"/api/frames?id={iid}",
    ]
    if rep_id:
        plan += [f"/api/report?id={rep_id}", f"/api/patchnotes?id={quote(rep_id)}"]
    if en:
        plan += [f"/api/enemy?id={en['id']}", f"/api/enemy_thumb?app={quote(en['app'])}", f"/api/char_icon?id={quote(en['app'])}"]
    if sp:
        plan += [f"/api/spine_scene?bundle={sp['bundle']}&atlas={sp['atlas']}",
                 f"/spine/{sp['bundle']}/{sp['atlas']}/skeleton.json", f"/spine/{sp['bundle']}/{sp['atlas']}/skeleton.atlas"]
    if clip:
        plan.append("/api/clip?" + urlencode({"bundle": clip["bundle"], "clip": clip["clip"], "go": clip["animator_go"]}))
    if ep:
        plan.append(f"/api/story_ep?id={quote(ep)}")
    if music:
        plan.append("/api/music_audio?n=0")
    if line:
        plan.append(f"/api/quiz_audio?s={quote(line[0])}")
    if bvid:
        plan.append(f"/api/buff_video?name={quote(bvid)}")
    if node:
        plan.append(f"/api/stage_node_pic?id={node}")
    if lang:
        plan.append(f"/api/lang?id={quote(lang)}")
    if thumb:
        plan += [f"/api/asset_thumb?path={quote(thumb)}", f"/api/container?path={quote(thumb)}"]
    if art:
        plan.append(f"/api/asset_img?path={quote(art)}")
    if chars.get("groups") is None:
        plan.append("/api/characters")
    return plan


def check_api(rep, base, slow_ms):
    got = {}

    def g(path):
        r = got.get(path) or get(base, path)
        got[path] = r
        return r.get("json")

    for path in api_plan(g) + [p for p in list(got)]:
        if path not in got:
            got[path] = get(base, path)
    for path, r in got.items():
        key = path.split("?")[0]
        rep.answers[path] = {k: r.get(k) for k in ("code", "ms", "size", "sha")}
        err = r.get("error") or (isinstance(r.get("json"), dict) and r["json"].get("error"))
        if r["code"] == 0 or r["code"] >= 500:
            rep.fail("api", path, f"{r['code']} {err or ''}".strip())
        elif r["code"] == 404 and "release build" in str(err):
            rep.warn("api", path, "needs the private player code")
        elif r["code"] >= 400:
            rep.warn("api", path, f"{r['code']} {err or ''}".strip())
        elif r.get("error"):
            rep.fail("api", path, r["error"])
        if r.get("ms", 0) > slow_ms and key not in QUIET:
            rep.warn("slow", path, f"{r['ms']} ms")


def compare(rep, base_file):
    try:
        with open(base_file, encoding="utf-8") as f:
            old = json.load(f)["answers"]
    except (OSError, ValueError, KeyError):
        return False
    for path, a in rep.answers.items():
        b = old.get(path)
        if not b:
            continue
        if a["code"] != b["code"]:
            rep.fail("diff", path, f"status {b['code']} -> {a['code']}")
        elif a["sha"] != b["sha"] and path.split("?")[0] not in VOLATILE:
            rep.warn("diff", path, f"answer changed ({b['size']} -> {a['size']} bytes)")
    for path in old:
        if path not in rep.answers:
            rep.warn("diff", path, "not asked this time")
    return True


class Cdp:
    def __init__(self, ws_url):
        from websocket import create_connection
        self.ws = create_connection(ws_url, suppress_origin=True, timeout=120)
        self.n, self.events, self.replies = 0, [], {}
        self.lock = threading.Condition()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            try:
                m = json.loads(self.ws.recv())
            except Exception:
                return
            with self.lock:
                if "id" in m:
                    self.replies[m["id"]] = m
                else:
                    self.events.append(m)
                self.lock.notify_all()

    def call(self, method, **params):
        with self.lock:
            self.n += 1
            n = self.n
        self.ws.send(json.dumps({"id": n, "method": method, "params": params}))
        end = time.time() + 120
        with self.lock:
            while n not in self.replies and time.time() < end:
                self.lock.wait(1)
            return self.replies.pop(n, {}).get("result", {})

    def js(self, expr):
        return self.call("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True).get("result", {}).get("value")

    def take(self):
        with self.lock:
            ev, self.events = self.events, []
        return ev


def check_pages(rep, base, only=None, shots=False):
    from limbusdm.sitecheck import _free_port, find_browser
    exe = find_browser()
    if not exe:
        rep.warn("pages", "browser", "no Edge or Chrome: pages not opened")
        return
    port, prof = _free_port(), tempfile.mkdtemp(prefix="limbus-check-")
    proc = subprocess.Popen([exe, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                             "--window-size=1600,1000", "--remote-allow-origins=*", "--mute-audio", "--no-first-run",
                             "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE cdn.jsdelivr.net",
                             "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tab = None
    try:
        tabs = None
        for _ in range(80):
            try:
                tabs = json.load(urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                break
            except Exception:
                time.sleep(0.25)
        if not tabs:
            raise RuntimeError("the browser didn't start")
        tab = Cdp(first(tabs, lambda t: t["type"] == "page")["webSocketDebuggerUrl"])
        for d in ("Page", "Runtime", "Network", "Log"):
            tab.call(d + ".enable")
        visit(tab, base, "", 0)
        routes = tab.js("typeof routes === 'object' ? Object.keys(routes) : []") or []
        if not routes:
            rep.fail("pages", "app", "no routes found: the shell did not start")
        todo = [r for r in routes if not only or r in only]
        os.makedirs(os.path.join(OUT, "shots"), exist_ok=True)
        tty = sys.stdout.isatty()
        for i, r in enumerate(todo, 1):
            if tty:
                print(f"\r  pages {i}/{len(todo)} {r:<24}", end="", flush=True)
            res = visit(tab, base, r, i)
            for level, msg in res:
                (rep.fail if level == "FAIL" else rep.warn)("pages", "#/" + r, msg)
            if shots:
                import base64
                img = tab.call("Page.captureScreenshot", format="png").get("data")
                if img:
                    with open(os.path.join(OUT, "shots", r + ".png"), "wb") as f:
                        f.write(base64.b64decode(img))
        if tty:
            print("\r" + " " * 50 + "\r", end="")
    except Exception as e:
        rep.fail("pages", "browser", f"{type(e).__name__}: {e}")
    finally:
        try:
            tab and tab.call("Browser.close")
        except Exception:
            pass
        try:
            proc.wait(5)
        except Exception:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        shutil.rmtree(prof, ignore_errors=True)


# pictures a page drew with no address (a link missing from an answer) or that didn't load
BAD_IMGS = r"""[...document.images].filter((i) => { const s = i.getAttribute("src");
  return s !== null && (!s.trim() || /(^|\/)(undefined|null)$/.test(s)) || (i.complete && i.currentSrc && !i.naturalWidth && i.style.visibility !== "hidden"); })
  .slice(0, 5).map((i) => i.getAttribute("src") || "(empty)")"""


def visit(tab, base, route, n, settle=1.5, longest=15):
    tab.take()
    tab.call("Page.navigate", url=f"{base}/?check={n}#/{route}")
    start = last = time.time()
    reqs, out = {}, []
    while time.time() - start < longest:
        time.sleep(0.25)
        for ev in tab.take():
            m, p = ev.get("method"), ev.get("params", {})
            if m == "Network.requestWillBeSent":
                rq = p["request"]
                reqs[p["requestId"]] = (rq["method"], rq["url"])
                if not any(q in rq["url"] for q in QUIET):
                    last = time.time()
            elif m == "Network.responseReceived":
                meth, url = reqs.get(p["requestId"], ("GET", p["response"]["url"]))
                code = p["response"]["status"]
                if url.startswith(base) and meth == "GET":
                    if code >= 500:
                        out.append(("FAIL", f"{code} {url[len(base):]}"))
                    elif code == 404 and ("/api/" in url or p.get("type") == "Image"):
                        out.append(("warn", f"404 {url[len(base):]}"))
            elif m == "Network.loadingFailed":
                meth, url = reqs.get(p["requestId"], ("GET", "?"))
                if url.startswith(base) and meth == "GET" and p.get("errorText") != "net::ERR_ABORTED" and not p.get("canceled"):
                    out.append(("FAIL", f"{p.get('errorText')} {url[len(base):]}"))
            elif m == "Runtime.exceptionThrown":
                d = p["exceptionDetails"]
                msg = (d.get("exception") or {}).get("description") or d.get("text", "")
                if "check: read only" not in msg:
                    loc = f" ({d.get('url', '').replace(base, '')}:{d.get('lineNumber', 0) + 1})" if d.get("url") else ""
                    out.append(("FAIL", msg.splitlines()[0][:300] + loc))
            elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
                msg = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
                if "check: read only" not in msg:
                    out.append(("warn", "console: " + msg[:300]))
        if time.time() - start > 2 and time.time() - last > settle:
            break
    for src in tab.js(BAD_IMGS) or []:
        out.append(("warn", f"picture without a file: {src[:200]}"))
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def main():
    ap = argparse.ArgumentParser(description="Limbus Archive self-check: code, every /api route, every page.")
    ap.add_argument("parts", nargs="*", default=["code", "api", "pages"], help="code / api / pages (default: all)")
    ap.add_argument("--url", help="check a running app (e.g. a test build) instead of the source")
    ap.add_argument("--save", action="store_true", help="keep this run's answers as the baseline")
    ap.add_argument("--page", action="append", help="only these pages (route names)")
    ap.add_argument("--shots", action="store_true", help="screenshot every page into build/check/shots")
    ap.add_argument("--slow", type=int, default=5000, help="warn about answers slower than this (ms)")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    rep, t0 = Report(), time.time()
    if "code" in a.parts:
        print("code...")
        check_code(rep)
    httpd, base = (None, a.url.rstrip("/")) if a.url else (None, None)
    if ("api" in a.parts or "pages" in a.parts) and not base:
        print("starting the server from the source (read only)...")
        httpd, base = start_server(rep)
    if "api" in a.parts:
        print("api...")
        check_api(rep, base, a.slow)
    if "pages" in a.parts:
        print("pages...")
        check_pages(rep, base, set(a.page) if a.page else None, a.shots)
    base_file = os.path.join(OUT, "baseline.json")
    compared = bool(rep.answers) and not a.save and compare(rep, base_file)
    result = {"when": time.strftime("%Y-%m-%d %H:%M:%S"), "seconds": round(time.time() - t0), "items": rep.items,
              "answers": rep.answers, "tracebacks": rep.tracebacks}
    with open(os.path.join(OUT, "last.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    if a.save and rep.answers:
        shutil.copyfile(os.path.join(OUT, "last.json"), base_file)
    if httpd:
        httpd.shutdown()
    fails = [x for x in rep.items if x["level"] == "FAIL"]
    for x in sorted(rep.items, key=lambda x: (x["level"] != "FAIL", x["part"])):
        print(f"{x['level']:4}  {x['part']:6} {x['what']}: {x['msg']}")
    for t in rep.tracebacks:
        lines = t["tb"].rstrip().splitlines()
        print(f"\ntraceback {t['path']}\n" + "\n".join(lines[-3:]))
    print(f"\n{len(fails)} failed, {len(rep.items) - len(fails)} warnings, {len(rep.answers)} answers, "
          f"{result['seconds']} s{' - compared with the baseline' if compared else ''}{' - baseline saved' if a.save else ''}")
    print(f"full report: {os.path.relpath(os.path.join(OUT, 'last.json'), ROOT)}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
