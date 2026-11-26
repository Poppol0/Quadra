"""Quadra local storage configuration (standard library only).

Program resources and writable personal data must always live in separate folders.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys

APP_NAME = 'Quadra'


def default_data_dir() -> Path:
    home = Path.home()
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA') or home / 'AppData' / 'Local') / APP_NAME
    if sys.platform == 'darwin':
        return home / 'Library' / 'Application Support' / APP_NAME
    return Path(os.environ.get('XDG_DATA_HOME') or home / '.local' / 'share') / APP_NAME


def config_file() -> Path:
    home = Path.home()
    if sys.platform == 'win32':
        folder = Path(os.environ.get('APPDATA') or home / 'AppData' / 'Roaming') / APP_NAME
    elif sys.platform == 'darwin':
        folder = home / 'Library' / 'Preferences' / APP_NAME
    else:
        folder = Path(os.environ.get('XDG_CONFIG_HOME') or home / '.config') / APP_NAME
    return folder / 'config.json'


def _absolute(path) -> Path:
    value = os.path.expandvars(os.path.expanduser(str(path).strip()))
    if not value:
        raise ValueError('Percorso archivio vuoto')
    path = Path(value)
    if not path.is_absolute():
        raise ValueError('Usa un percorso assoluto per la cartella dati')
    return path.resolve()


def ensure_external(path: Path, program_dir: Path) -> Path:
    path = _absolute(path)
    program_dir = program_dir.resolve()
    if path == program_dir or program_dir in path.parents or path in program_dir.parents:
        raise ValueError('La cartella dati non puo trovarsi dentro la cartella del programma')
    return path


def configured_data_dir(program_dir: Path, command_line=None) -> Path:
    if command_line:
        return ensure_external(command_line, program_dir)
    env = os.environ.get('QUADRA_DATA_DIR')
    if env:
        return ensure_external(env, program_dir)
    config = config_file()
    if config.is_file():
        try:
            content = json.loads(config.read_text(encoding='utf-8'))
            if isinstance(content, dict) and content.get('data_dir'):
                return ensure_external(content['data_dir'], program_dir)
        except (json.JSONDecodeError, OSError, ValueError) as exc:
            raise ValueError('Configurazione cartella dati non valida: ' + str(exc)) from exc
    return ensure_external(default_data_dir(), program_dir)


def save_data_dir(folder, program_dir: Path) -> Path:
    folder = ensure_external(folder, program_dir)
    target = config_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt':
        target.parent.chmod(0o700)
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps({'data_dir': str(folder)}, indent=2), encoding='utf-8')
    if os.name != 'nt':
        temp.chmod(0o600)
    temp.replace(target)
    return folder
