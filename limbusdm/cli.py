"""Command line: python -m limbusdm.cli snapshot | diff <old> <new> | list"""
from __future__ import annotations

import os
import sys
import time

from .paths import GamePaths, data_dir
from .snapshot import Snapshotter, list_snapshots
from .store import Store


def main(argv=None):
    argv = argv or sys.argv[1:]
    store = Store(data_dir())
    cmd = argv[0] if argv else "list"
    if cmd == "snapshot":
        last = [0.0]

        def progress(stage, done, total, msg=""):
            if time.time() - last[0] > 2 or stage == "done":
                last[0] = time.time()
                print(f"[{time.strftime('%H:%M:%S')}] {stage} {done}/{total} {msg}", flush=True)

        snaps = list_snapshots(store)
        prev = store.read_json(f"snapshots/{snaps[-1]['id']}.json.gz") if snaps else None
        snap = Snapshotter(store, GamePaths(), progress=progress).take(prev)
        print("snapshot:", snap["id"], "bundles:", len(snap["bundles"]), "missing:", len(snap["missing_bundles"]),
              "files:", len(snap["files"]), "bundles with errors:", len(snap["errors"]))
    elif cmd == "diff":
        from .diff import diff_snapshots
        rep = diff_snapshots(store, argv[1], argv[2])
        print({k: len(v) if isinstance(v, list) else v for k, v in rep["summary"].items()})
    elif cmd == "site":  # site [serve | <report id>…]: write the web copy into data/site (limbusdm/site.py), or look at it
        from . import site
        from .server import serve
        from .service import Service
        svc = Service(data_dir())
        if argv[1:2] == ["serve"]:  # site serve [packed]
            return site.preview(site.packed_dir(svc) if argv[2:3] == ["packed"] else site.out_dir(svc))
        if argv[1:2] == ["pack"]:  # the folder that goes up: files glued into packs
            r = site.pack(site.out_dir(svc), site.packed_dir(svc), site.pack_index_path(svc))
            return print(f"{site.packed_dir(svc)}: {r['files']} files, {r['bytes'] / 1e6:.0f} MB")
        last = [0.0]

        def progress(stage, done, total, msg=""):
            if time.time() - last[0] > 5 or done == total:
                last[0] = time.time()
                print(f"[{time.strftime('%H:%M:%S')}] {stage} {done}/{total}", flush=True)

        httpd = serve(svc, 0)
        r = site.export(svc, f"http://127.0.0.1:{httpd.server_address[1]}", argv[1:] or None, progress=progress)
        print(f"{r['dir']}: {r['size']['files']} files, {r['size']['bytes'] / 1e6:.0f} MB, {r['failed']} requests without an answer")
    else:
        for s in list_snapshots(store):
            print(s["id"])


if __name__ == "__main__":
    main()
