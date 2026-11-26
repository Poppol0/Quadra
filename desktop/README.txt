QUADRA DESKTOP - CODICE SORGENTE

Base unica di sviluppo Quadra, fase 3. I file HTML, CSS e JavaScript
originali sono in assets/, insieme al catalogo neutro di categorie.
Il motore locale e stato implementato in Go utilizzando solo la standard
library. I dati personali non sono presenti in questo pacchetto.

REQUISITI DI COMPILAZIONE
Go 1.22+ su Windows, Linux o macOS.

PER CREARE Quadra.exe PORTABILE PER WINDOWS 64 BIT
Su Linux / macOS:
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-H=windowsgui -s -w" -o Quadra.exe .

Su Windows PowerShell:
  go build -trimpath -ldflags="-H=windowsgui -s -w" -o Quadra.exe .

PER TESTARE IL SERVER LOCALE
  go run . --serve-only --port 8765 --data-dir /percorso/assoluto/privato
(Windows: usa un percorso Windows assoluto.)

TEST
  go test ./...
Il test storico facoltativo usa QUADRA_LEGACY_ZIP e QUADRA_SOURCE_XLSX.
Non includere mai tali file negli archivi sorgenti distribuiti.

LANCIO
La finestra Windows e aperta da Microsoft Edge in modalita app,
con profilo dedicato locale. Il codice non richiede Python, Electron,
servizi cloud, ne account online.

Le API REST, il formato JSON e la struttura del backup completo ZIP
sono compatibili con le versioni precedenti di Quadra; gli allegati
rimangono sotto la cartella dati privata.
