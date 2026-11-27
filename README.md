# Quadra

**Quadra** e un'applicazione di contabilità familiare offline. Il progetto comprende l'interfaccia web locale, il motore desktop Go per Windows, il programma di installazione e il codice Python della precedente implementazione per compatibilita e migrazione.

> **Privacy:** la repository contiene solo codice, risorse grafiche e un archivio *iniziale vuoto* con categorie generiche. Non caricare dati bancari, `archivio.json` personali, ricevute, estratti conto, backup ZIP o credenziali. La visibilita privata di GitHub non sostituisce queste precauzioni.

## Struttura

- [`desktop/`](desktop/) - **versione corrente**: backend Go, interfaccia HTML/CSS/JS, template neutro e test.
- [`installer/`](installer/) - sorgenti dell'installer e del disinstallatore Windows, piu risorse grafiche.
- [`scripts/build_windows.py`](scripts/build_windows.py) - build riproducibile di portabile e installer a partire dai sorgenti (Go e Python richiesti solo per compilare).
- [`legacy-python/`](legacy-python/) - versione web locale precedente, mantenuta come riferimento tecnico per migrazioni.
- [`docs/Brand_Identity.pdf`](docs/Brand_Identity.pdf) - identita visiva Quadra.
- [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md) e [`docs/SICUREZZA.md`](docs/SICUREZZA.md) - descrizione tecnica e gestione sicura dei dati.

## Avvio per sviluppo

Richiede **Go 1.22 o successivo**.

```bash
cd desktop
go test ./...
go run . --serve-only --port 8765 --data-dir /percorso/privato
```

Apri `http://127.0.0.1:8765` nel browser. Evita di usare la cartella della repository come directory dati.

## Creazione eseguibile Windows e installer

Richiede Go (1.23+ consigliato) e Python 3 sul computer di *compilazione*. Gli utenti finali **non** devono installare Python.

```bash
python scripts/build_windows.py
```

Il comando genera nella cartella ignorata `dist/`:

- `Quadra_Desktop_Windows.zip` - applicazione portabile.
- `Quadra_Installer_Windows.exe` - programma di installazione per utente corrente.

I binari prodotti non sono versionati nella repository. Il codice di compilazione e le risorse sono invece versionati.

## Archivi e aggiornamenti

Il programma conserva i dati fuori dalla cartella di installazione, normalmente in `%LOCALAPPDATA%\Quadra` su Windows. I backup completi includono l'archivio JSON e, quando presenti, gli allegati. La copia vergine della repository non contiene movimenti o saldi.

Prima di qualunque migrazione: fai un backup completo ZIP, conserva una copia locale e confronta il numero di movimenti, conti, scadenze e documenti dopo l'importazione.

## Stato

Base di sviluppo unificata di Quadra Desktop e installer Windows. L'eseguibile generato va provato su un PC Windows reale; la semplice cross-compilazione non costituisce un collaudo dell'installazione.

Tutti i diritti riservati al titolare del progetto. Nessuna licenza open source e concessa automaticamente dalla presenza del codice in questa repository.

## Revisione interfaccia e salvataggi locali

Le Impostazioni consentono di configurare **due cartelle distinte**: una per
l'archivio e i documenti del gestionale e una per le copie di sicurezza.
Quadra trasferisce i file tramite copia verificata, senza cancellare l'origine,
e richiede un riavvio quando si cambia la cartella dei dati. Il backup ZIP puo
essere salvato direttamente nella cartella scelta, oppure scaricato.
La funzione di selezione grafica delle cartelle e disponibile nella versione
Desktop Windows. Nessun dato personale viene incluso nei sorgenti o nell'installer.
