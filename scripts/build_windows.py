#!/usr/bin/env python3
"""Compila la distribuzione Windows di Quadra dai sorgenti, senza dati personali."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
INSTALLER = ROOT / "installer"
ASSETS = INSTALLER / "assets"
BUILD = ROOT / "build"
DIST = ROOT / "dist"


def run(command: list[str], cwd: Path, env: dict[str, str]) -> None:
    print("+", " ".join(command), "[", cwd, "]", flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main() -> int:
    if not shutil.which("go"):
        raise SystemExit("Go non trovato: installare Go 1.23+ sul PC di compilazione")
    BUILD.mkdir(exist_ok=True)
    DIST.mkdir(exist_ok=True)
    env = dict(os.environ, GOOS="windows", GOARCH="amd64", CGO_ENABLED="0")
    gui = "-H=windowsgui -s -w"
    console = "-s -w"

    # La versione GUI apre Microsoft Edge in una finestra dedicata.
    run(["go", "test", "./..."], DESKTOP, dict(os.environ))
    run(["go", "build", "-trimpath", "-ldflags=" + gui, "-o", str(BUILD / "Quadra.exe"), "."], DESKTOP, env)
    run(["go", "build", "-trimpath", "-ldflags=" + console, "-o", str(BUILD / "Quadra_diagnostica.exe"), "."], DESKTOP, env)

    wanted = [
        "Quadra.exe",
        "Quadra_diagnostica.exe",
        "Quadra.ico",
        "LEGGIMI_PRIMA.txt",
        "CONFIGURA_DATI_WINDOWS.bat",
        "CONFIGURA_DATI_WINDOWS.ps1",
        "CREA_COLLEGAMENTO_DESKTOP.bat",
    ]
    for name in wanted:
        if name not in ("Quadra.exe", "Quadra_diagnostica.exe"):
            shutil.copyfile(ASSETS / name, BUILD / name)

    def fill(z: zipfile.ZipFile, prefix: str = "") -> None:
        for name in wanted:
            z.write(BUILD / name, arcname=prefix + name)

    with zipfile.ZipFile(DIST / "Quadra_Desktop_Windows.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=8) as z:
        fill(z, "Quadra/")
    with zipfile.ZipFile(INSTALLER / "setup" / "payload.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=8) as z:
        fill(z)

    generated = [
        INSTALLER / "uninstall" / "quadra_windows_amd64.syso",
        INSTALLER / "setup" / "quadra_windows_amd64.syso",
        INSTALLER / "setup" / "payload.zip",
        INSTALLER / "setup" / "QuadraUninstall.exe",
    ]
    try:
        for dest in generated[:2]:
            run([sys.executable, str(INSTALLER / "build_resources.py"), str(dest), str(ASSETS / "Quadra.ico")], ROOT, dict(os.environ))
        run(["go", "build", "-trimpath", "-ldflags=" + gui, "-o", str(INSTALLER / "setup" / "QuadraUninstall.exe"), "."], INSTALLER / "uninstall", env)
        run(["go", "build", "-trimpath", "-ldflags=" + gui, "-o", str(DIST / "Quadra_Installer_Windows.exe"), "."], INSTALLER / "setup", env)
    finally:
        # Gli artefatti temporanei non restano nella cartella dei sorgenti.
        for item in generated:
            item.unlink(missing_ok=True)
    print("Creati:", DIST / "Quadra_Desktop_Windows.zip", "e", DIST / "Quadra_Installer_Windows.exe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
