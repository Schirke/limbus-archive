"""Compiles the private modules (every .py of a folder) into limbusdm.<name> .pyd files with Cython; needs MSVC.
Usage: python scripts/build_private.py <src dir> <out dir>"""
import glob
import os
import subprocess
import sys

from Cython.Build import cythonize
from setuptools import Extension, setup


def msvc_env():
    """Takes vcvars64's environment when setuptools can't find Visual Studio itself."""
    vswhere = os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Microsoft Visual Studio", "Installer", "vswhere.exe")
    if os.environ.get("DISTUTILS_USE_SDK") or not os.path.exists(vswhere):
        return
    found = subprocess.run([vswhere, "-all", "-products", "*", "-latest", "-find", r"VC\Auxiliary\Build\vcvars64.bat"],
                           capture_output=True, text=True).stdout.splitlines()
    if not found:
        return
    out = subprocess.run(f'call "{found[0]}" >nul && set', shell=True, capture_output=True, text=True).stdout
    os.environ.update(line.split("=", 1) for line in out.splitlines() if "=" in line)
    os.environ.update(DISTUTILS_USE_SDK="1", MSSdk="1")


def imports(files) -> list[str]:
    """Absolute imports of these files: PyInstaller can't see a .pyd's, so the build names them (hidden.txt)."""
    import ast
    mods = set()
    for f in files:
        with open(f, encoding="utf-8") as fh:
            for n in ast.walk(ast.parse(fh.read())):
                if isinstance(n, ast.Import):
                    mods |= {a.name for a in n.names}
                elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module and n.module != "__future__":
                    mods.add(n.module)
    return sorted(mods)


def main(src, out):
    os.makedirs(os.path.join(out, "limbusdm"), exist_ok=True)
    files = sorted(glob.glob(os.path.join(src, "*.py")))
    with open(os.path.join(out, "hidden.txt"), "w", encoding="utf-8") as f:
        names = [f"limbusdm.{os.path.splitext(os.path.basename(x))[0]}" for x in files]  # (some only .pyd import)
        f.write("\n".join(imports(files) + names) + "\n")
    exts = []
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        dst = os.path.join(out, "limbusdm", name + ".py")
        with open(f, "rb") as a, open(dst, "wb") as b:
            b.write(a.read())
        exts.append(Extension(f"limbusdm.{name}", [dst]))
    msvc_env()
    os.chdir(out)
    for e in exts:
        e.sources = [os.path.relpath(s, out) for s in e.sources]
    setup(ext_modules=cythonize(exts, quiet=True, compiler_directives={"language_level": 3, "annotation_typing": False}),
          script_args=["build_ext", "--inplace"])
    for e in exts:
        os.remove(e.sources[0])
        os.remove(e.sources[0][:-3] + ".c")


if __name__ == "__main__":
    main(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]))
