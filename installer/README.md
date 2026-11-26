# Installer Windows

I sorgenti sono in `setup/main_windows.go`, `uninstall/main_windows.go` e `build_resources.py`.

Esegui dalla radice della repository:

```bash
python scripts/build_windows.py
```

Lo script compila il backend Go Windows, il disinstallatore, crea temporaneamente `setup/payload.zip` e `setup/QuadraUninstall.exe`, genera le risorse COFF per l'icona e compila l'installer.

L'installer installa per l'utente corrente sotto `%LOCALAPPDATA%\Programs\Quadra` e non deve cancellare `%LOCALAPPDATA%\Quadra`, che contiene i dati personali.

I file generati (binari, `.syso`, `payload.zip`) sono ignorati da Git. Non includere il database o backup nello ZIP payload.
