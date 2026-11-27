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

## Impostazioni percorsi locali (Quadra Desktop)

In **Impostazioni > Dove sono i dati** è possibile scegliere separatamente la cartella
per `archivio.json`, `allegati/`, `estratti/` e quella per i backup automatici e i
backup ZIP creati dall'app. La selezione grafica avviene tramite la finestra
nativa di Windows; il server Go, raggiungibile soltanto da localhost e con
controllo dell'origine, effettua le operazioni sul disco.

Endpoint locali:

- `GET /api/storage` mostra i due percorsi attivi e l'eventuale riavvio richiesto.
- `POST /api/storage/pick-folder` apre la scelta della cartella in Windows.
- `POST /api/storage/configure-folder` copia i file esistenti in una **cartella vuota**,
  ne verifica il contenuto e salva la nuova destinazione in
  `%APPDATA%/Quadra/config.json` (`data_dir`, `backup_dir`). Non cancella l'origine.
- `POST /api/backup/save-to-folder` crea un backup completo ZIP direttamente
  nella cartella backup configurata. Il download manuale del ZIP resta disponibile.

Per il cambio della cartella dati viene creato prima un backup completo e il
programma blocca le scritture successive fino alla chiusura e riapertura. La
cartella precedentemente in uso rimane sul disco per consentire un recupero
manuale. Il cambio della sola cartella backup è operativo immediatamente.

L'interfaccia del periodo in Panoramica e Bilanci annuali utilizza controlli su
una sola riga, con denominazione del trimestre abbreviata su schermi piccoli.
