# Quadra online

Destinazione: browser e PWA su PC, tablet e telefoni, non solo mobile.
La regola Drive è identica su ogni dispositivo. La versione desktop Go resta
disponibile separatamente e non acquisisce automaticamente la sincronizzazione.

Branch `feat/online-version`. L'interfaccia esistente, i temi e la navigazione
sono riutilizzati senza redesign. Solo nella build online si aggiunge il
pulsante **Sincronizza**; le indicazioni sui percorsi descrivono lo storage del
browser. I file desktop originali rimangono invariati.

## Sviluppo locale

Su Windows puoi usare direttamente `AVVIA_QUADRA_ONLINE.cmd` nella radice
del progetto: controlla Node.js, installa le dipendenze mancanti, genera la
build e avvia il server. Apri l'indirizzo mostrato e lascia la finestra aperta.
Per la procedura dettagliata vedi la sezione finale del changelog del ramo.

Richiede Node.js 20 o successivo. Dalla radice del progetto:

```powershell
cd online
npm ci --ignore-scripts
cd ..
node scripts/build_online.mjs
node scripts/serve_online.mjs
```

Aprire `http://127.0.0.1:8080`. Il server ascolta soltanto sul PC.
L'archivio browser è separato da quello desktop. Per trasferire dati usare
esportazione e ripristino ZIP. Per eseguire i test dopo la build:

```powershell
cd online
npm test
```

## Funzioni implementate

- Archivio e documenti in IndexedDB, scritture transazionali e revisione
  contro modifiche concorrenti da altre schede.
- Allegati JPG, PNG, WEBP e PDF, estratti PDF, anteprime e rimozione.
- Backup ZIP con `archivio.json`, `allegati/`, `estratti/` e manifest SHA-256;
  ripristino con anteprima e conferma. Copie precedenti in IndexedDB, chiavi
  `backup:*`. File ZIP validati e limitati prima della decompressione.
- Importazione CSV/XLSX nel browser attraverso le schermate esistenti.
- Cache offline delle risorse dell'app; documenti privati in IndexedDB.
- Google Drive con scope `drive.file`, token solo in memoria e un unico
  `Quadra.zip`, creato al primo caricamento e aggiornato successivamente.

Le librerie ZIP/XLSX sono incluse nella build, senza CDN durante l'uso
offline. Sono gratuite: fflate (MIT) e SheetJS CE (Apache-2.0). Le rispettive
licenze sono incluse in `vendor/`.

## Regola di sincronizzazione

Ogni apertura mostra una schermata con **Accedi con Google** e **Usa i dati
locali**, disponibili fin dall'inizio. Scegliendo Google, il clic avvia
l'autorizzazione e poi
la sincronizzazione: OAuth browser richiede un gesto dell'utente.
Il token non viene salvato tra sessioni.

Durante la sincronizzazione il pulsante mostra un indicatore animato,
diventa temporaneamente non premibile e compare “Sincronizzazione in corso”.
Lo stato viene ripristinato anche in caso di errore. Si può lavorare sui dati
locali senza Google e collegare Drive in seguito: le operazioni sono salvate
in IndexedDB e la successiva sincronizzazione rileva eventuali conflitti.

## Copia automatica fuori dal browser

Scegliendo **Usa i dati locali**, sui dispositivi diversi da iPhone/iPad è
obbligatorio collegare una cartella con un browser compatibile. All'accesso
il ZIP nella cartella viene caricato come archivio autorevole. IndexedDB
resta una cache di lavoro e di recupero, non l'unica persistenza dei salvataggi
riusciti. Un errore di scrittura su disco viene propagato al chiamante.
Scegliendo Google la cartella non è obbligatoria. I browser non iOS senza
accesso alle cartelle devono usare Drive o un browser compatibile.

Su iPhone, in modalità locale, le modifiche attivano un promemoria con
**Salva backup** e **Ho salvato il backup**. La conferma è esplicita, perché
la preparazione del download non prova che il file sia stato salvato in File.
Il promemoria ricompare al rientro e resta memorizzato fra sessioni. Non vengono
usati popup nativi di uscita: iOS non garantisce un evento quando l'app viene
chiusa o terminata e il promemoria rimane visibile nell'app.

Nei browser che supportano `showDirectoryPicker`, in Impostazioni è presente
**Collega cartella locale**. La scelta autorizza la scrittura di un unico
`Quadra.zip`: ogni salvataggio dell'archivio o dei documenti lo aggiorna con
una copia completa. Le scritture sono serializzate; quando disponibile,
Web Locks coordina le schede. Gli errori su disco non cancellano il salvataggio
IndexedDB e vengono segnalati. Se serve, il pulsante riautorizza la cartella.

Cancellare la cache delle pagine non elimina IndexedDB; cancellare tutti i
dati del sito invece sì. Il ZIP nella cartella scelta resta sul disco anche
in questo caso. Per recuperarlo si ricollega la cartella e si conferma il
caricamento del ZIP esistente, oppure si usa il ripristino ZIP abituale.
Su browser senza accesso alle cartelle, restano IndexedDB, download del
backup e Drive. Non si promette una scrittura automatica nel filesystem
su tutte le piattaforme. La funzione va collaudata anche nel browser reale.

Dopo l'accesso, sincronizzazione **soltanto premendo Sincronizza**.
Nessun timer, invio al salvataggio, alla chiusura o al ritorno della rete.
Un pulsante ripremuto durante una sincronizzazione riusa l'operazione in
corso. Offline o in caso di errore si può accedere alla copia locale con
messaggio esplicito: non equivale a una sincronizzazione riuscita.

Il primo caricamento crea `Quadra.zip`; quelli successivi aggiornano lo stesso
ID di file. La revisione Drive distingue aggiornamenti remoti anche quando
l'ID rimane uguale. Prima di aggiornare si conserva una copia del ZIP remoto
in IndexedDB (`backup:drive:*`), si legge l'ETag dal JSON delle API Drive v2 e si invia `If-Match` sulla
richiesta che modifica effettivamente il contenuto. Senza ETag si blocca
l'aggiornamento; HTTP 412 segnala una modifica concorrente. Questa parte
richiede ancora verifica con API reali; non dipende dall'esposizione CORS dell'header ETag.

Se locale e remoto sono cambiati, l'accesso automatico segnala il conflitto.
Con **Sincronizza** si sceglie la copia locale o remota. Nessun merge automatico
dei movimenti. Dopo il successo i vecchi ZIP vengono spostati nel cestino,
esclusivamente se hanno i metadati privati di Quadra, appartengono allo stesso
spazio e hanno un nome ZIP Quadra. Il file attivo è sempre escluso. Un nome
simile da solo non autorizza la pulizia; altri file e cartelle non sono toccati.
Quando possibile si
riusa l'unica versione finale del vecchio schema, rinominandola `Quadra.zip`
al successivo aggiornamento. Più archivi concorrenti richiedono verifica
manuale e non vengono aggiornati automaticamente.

## Configurazione Google

Il progetto attuale è un ambiente Google Cloud personale di test del
proprietario, non una configurazione di produzione. Per crearne uno nuovo
e sostituire `clientId` e lo spazio di test in `online/google-config.js`,
seguire la sezione **Google Cloud: configurazione di test e sostituzione**
nel changelog del ramo. Il cambio non migra automaticamente gli archivi.

1. Nel proprio progetto Google Cloud abilitare Google Drive API.
2. Configurare il consenso OAuth e aggiungere gli utenti di test, se il
   progetto è in modalità test.
3. Creare un client OAuth di tipo **Applicazione web**.
4. Inserire nelle origini JavaScript autorizzate `http://127.0.0.1:8080`
   e l'origine HTTPS di produzione. Se si usa localhost, autorizzarlo
   separatamente.
5. Il Client ID pubblico fornito dal proprietario è già configurato in
   `online/google-config.js`. Non serve un client secret.
6. Nell'app l'utente preme **Accedi con Google**: lo spazio personale viene
   individuato automaticamente, senza inserire Client ID o codici spazio.

Il collegamento è locale al dispositivo. Questa integrazione è per lo stesso
account Google su più dispositivi. L'identità Drive viene verificata prima
di sincronizzare: un account diverso da quello collegato all'archivio locale
viene rifiutato per evitare di mescolare i dati. La condivisione fra account
diversi richiederà Google Picker e gestione esplicita dei file condivisi.

Documentazione:
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads

## Pubblicazione HTTPS

`dist/online` è un sito statico: non richiede server Go o database cloud.
Pubblicarlo alla **radice** di un dominio o sottodominio HTTPS. Per un servizio
con piano gratuito, verificarne i limiti correnti prima di sceglierlo.
Non è obbligatorio acquistare un dominio.

I percorsi sono assoluti (`/app.js`, `/sw.js`): URL sotto una sottocartella
come `/Quadra/` non sono ancora supportati. Non distribuire `desktop/`,
`.git/`, archivi personali o configurazioni private. Autorizzare l'URL scelto
nel client OAuth Google.

Quando si aggiorna da una vecchia build, ricaricare con Ctrl+Shift+R per
abbandonare gli script già aperti. Il service worker attiva subito le nuove
versioni e preferisce le risorse di rete online, conservando la cache offline.
Una volta collegato un archivio, viene cercato direttamente per ID: un errore
o un file mancante non provoca la creazione automatica di un duplicato.

Non sono stati creati account esterni o pubblicati siti. Il Client ID OAuth
pubblico è incluso nella build; nessun token o client secret è nel repository.

## Verifiche e limiti

La suite verifica conflitti fra schede, allegati, checksum, ripristino,
CSV/XLSX, policy Drive con API simulate e avvio dell'interfaccia in jsdom.
Non sostituisce il collaudo Android/iOS: installazione, apertura offline,
layout, fotocamera, download e autorizzazione Google vanno verificati su
dispositivi reali. Il browser di verifica della sessione non era disponibile.
OAuth e API Drive reali richiedono ancora una prova con l'account dell'utente.

Cancellare i dati del sito elimina anche le copie IndexedDB: esportare ZIP
esterni. Il pulsante di salvataggio backup scarica il file sul dispositivo;
il selettore cartelle Windows resta una funzione desktop. Il recupero delle
copie `backup:*` non ha ancora un selettore nell'interfaccia. La validazione
browser non ha ancora parità con tutti i controlli contabili del backend Go.
