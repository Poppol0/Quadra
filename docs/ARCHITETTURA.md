# Architettura di Quadra

## Componenti

Quadra e un'applicazione locale basata su una UI HTML/CSS/JS e API HTTP esposte da un server che ascolta solo su `127.0.0.1`. La versione desktop corrente incorpora la UI nel binario Go (`embed.FS`). Su Windows la UI si apre in una finestra Microsoft Edge in modalita applicazione.

### Sorgenti principali

- `desktop/main.go`: avvio, server HTTP, finestra e arresto.
- `desktop/routes.go`: endpoint HTTP, importazione, allegati e salvataggio.
- `desktop/storage.go`: cartella dati privata e persistenza JSON.
- `desktop/backup.go`: creazione e ripristino del backup completo ZIP.
- `desktop/import.go`: parsing dei formati CSV e XLSX.
- `desktop/assets/`: interfaccia e tema grafico.
- `desktop/main_test.go`: test API, backup, importazione e sicurezza.
- `installer/setup/` e `installer/uninstall/`: installazione Windows per utente corrente.

## Persistenza

I dati di ogni installazione vengono memorizzati nella cartella scelta sul PC; quella predefinita e `%LOCALAPPDATA%\Quadra`. Sono separati dai file installati e dal codice del programma.

Il template incluso in `desktop/assets/templates/archivio_iniziale.json` e **vuoto** e contiene soltanto categorie generiche.

Gli allegati non sono incorporati nel JSON: il backup completo ZIP comprende `archivio.json`, `allegati/` e `estratti/` quando presenti.

## Limiti noti

- Non esiste un servizio cloud ne sincronizzazione tra dispositivi.
- Non esistono account personali: la sicurezza dei dati si basa sull'accesso locale al PC e alla cartella dati.
- L'installer va collaudato su Windows 10/11 per verificare anche scorciatoie, disinstallazione e protezioni antivirus.
- Il codice legacy Python e incluso per riferimento, non come requisito per il desktop corrente.
