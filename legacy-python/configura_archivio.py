#!/usr/bin/env python3
"""Select the separate local data folder used by Quadra. Run while app is closed."""
import argparse
from pathlib import Path
import sys

from data_paths import configured_data_dir, save_data_dir, config_file

BASE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description='Configura la cartella dati privata di Quadra')
    parser.add_argument('--path', help='Percorso assoluto da usare come cartella dati')
    parser.add_argument('--show', action='store_true', help='Visualizza la cartella configurata')
    args = parser.parse_args()
    try:
        current = configured_data_dir(BASE)
        print('Cartella dati attuale:', current)
        if args.show:
            return
        selection = args.path
        if not selection:
            try:
                from tkinter import Tk, filedialog
                root = Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                selection = filedialog.askdirectory(title='Scegli la cartella privata dei dati Quadra',
                                                    initialdir=str(current.parent if current.parent.exists() else Path.home()))
                root.destroy()
            except Exception as exc:
                print('Selezione grafica non disponibile:', exc, file=sys.stderr)
                print('Alternativa: python configura_archivio.py --path "PERCORSO_ASSOLUTO"')
                sys.exit(1)
        if not selection:
            print('Nessuna modifica.')
            return
        new = save_data_dir(selection, BASE)
        print('Nuova cartella dati:', new)
        print('La cartella precedente NON viene cancellata o spostata automaticamente.')
        print('Per recuperare i dati, avvia Quadra e usa Ripristina backup completo ZIP.')
        print('Chiudi Quadra prima di modificare la configurazione.')
    except ValueError as exc:
        print('Errore:', exc, file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
