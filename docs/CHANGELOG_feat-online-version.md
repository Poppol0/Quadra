# Quadra - Changelog del ramo online

**Ramo:** feat/online-version  
**Data:** 27 novembre 2026  
**Stato:** versione di sviluppo; non ancora collaudata per uso reale su tutte le piattaforme.

## Obiettivo

Rendere Quadra utilizzabile da PC, tablet e telefoni attraverso browser e PWA, conservando interfaccia, temi e navigazione della versione desktop. La sincronizzazione Google Drive è facoltativa. Per chi lavora senza Google, l'archivio deve restare sul dispositivo in una cartella scelta, quando il browser lo consente.

## Modifiche principali

- Build web statica indipendente dal motore Go, riutilizzando gli asset esistenti.
- Archivio di lavoro e documenti in IndexedDB, con controllo di revisione fra schede.
- Allegati e PDF, backup ZIP con checksum, ripristino e importazioni CSV/XLSX nel browser.
- Login Google e sincronizzazione manuale su un solo archivio Drive.
- Cartella locale come archivio di riferimento per l'accesso senza Google su dispositivi compatibili.
- Eccezione iPhone: archivio nel browser, backup esportabile in File e promemoria.
- Schermata iniziale dedicata, indicatore di sincronizzazione e modali custom.

## Confini del lavoro

La versione Go rimane disponibile e i suoi asset originali non vengono ridisegnati. Gli adattamenti web sono applicati alla build online. Non sono stati introdotti un server cloud proprietario, account Quadra o abbonamenti. Non è stata pubblicata una versione HTTPS durante questa lavorazione.

---

## Persistenza e lavoro senza Google

### Android e PC compatibili

Premendo **Usa i dati locali**, Quadra controlla la cartella già collegata. Se il permesso è valido, apre direttamente l'archivio. Se serve una nuova autorizzazione, mostra il nome della cartella e propone di autorizzarla. Se manca il collegamento, una modale spiega il funzionamento prima di aprire il selettore.

La cartella può avere qualsiasi nome. Al primo accesso viene creato **Quadra.zip**; se il file esiste, il suo contenuto viene caricato. Il file viene aggiornato dopo ogni operazione. IndexedDB rimane una cache di lavoro e recupero: l'archivio autorevole nella modalità locale è quello su disco.

Un errore di scrittura viene segnalato e propagato, senza dichiarare riuscito il salvataggio. Cancellare i dati del sito richiede di ricollegare la cartella, ma non elimina il file esterno. Il browser può chiedere nuovamente il permesso di accesso.

### Gestione nelle Impostazioni

- **Collega cartella locale** compare quando manca il collegamento.
- **Cambia cartella** copia l'archivio corrente nella nuova posizione e conserva la precedente.
- **Autorizza accesso** compare solo quando il permesso deve essere rinnovato.
- Una destinazione che contiene già Quadra.zip non viene sovrascritta dal cambio cartella.

### iPhone e iPad

L'accesso locale usa i dati del browser, perché la scrittura automatica in una cartella esterna non è disponibile nel flusso adottato. Il backup ZIP può essere esportato manualmente in File. Le modifiche attivano **Prima di chiudere, salva un backup**, con **Salva backup** e **Ho salvato il backup**.

Il promemoria resta attivo finché l'utente non conferma e viene riproposto al rientro. iOS non garantisce un evento di chiusura: il popup esattamente all'uscita non è garantito. La cancellazione completa dei dati del sito elimina anche il promemoria e i dati locali del browser; serve un backup esterno o Drive.

---

## Google Drive

### Accesso e regola di sincronizzazione

Il Client ID pubblico OAuth è configurato nell'app. Gli utenti non inseriscono Client ID o codici spazio. Accedono con Google e autorizzano lo scope drive.file. I token rimangono in memoria e non vengono salvati nel repository o tra sessioni.

Scegliendo Google dalla schermata iniziale, la sincronizzazione precede l'apertura dell'archivio. Successivamente avviene solo premendo **Sincronizza**: nessun timer, invio al salvataggio, alla chiusura o al ritorno della connessione. Durante l'operazione il pulsante mostra un loader, non è ripremibile e appare **Sincronizzazione in corso**.

### Un solo archivio remoto

Il primo caricamento crea **Quadra.zip**. I successivi aggiornano lo stesso ID di file. Quando il collegamento è noto, la ricerca avviene direttamente per ID: un errore o un file mancante non provocano la creazione di un sostituto.

Il confronto fra revisione remota e impronta locale distingue modifiche locali, remote e conflitti. Gli aggiornamenti condizionali usano l'ETag esposto nel JSON delle API Drive v2 e If-Match sulla richiesta di scrittura. Prima di sostituire il contenuto remoto viene conservata una copia locale di recupero. La gestione reale di queste richieste richiede ancora verifica con Google.

### Pulizia selettiva

Dopo una sincronizzazione riuscita, i vecchi ZIP vengono spostati nel cestino di Drive solo se hanno i metadati privati di Quadra, appartengono allo stesso spazio e hanno un nome ZIP Quadra. L'archivio attivo è escluso. Un nome simile non basta. Non vengono eseguite eliminazioni definitive.

### Limiti attuali

La sincronizzazione è pensata per lo stesso account Google su più dispositivi. La condivisione fra account diversi non è implementata. Un account diverso da quello associato all'archivio locale viene rifiutato per evitare di mescolare i dati. I conflitti richiedono una scelta esplicita: non è previsto il merge automatico dei movimenti.

---

## Interfaccia e flussi

### Schermata iniziale

Riquadro con identità Quadra e spiegazione dei percorsi di accesso. Prima **Usa i dati locali**, poi un divisore con **oppure**, quindi **Accedi con Google** con icona e nota sull'accesso facoltativo. Entrambe le azioni rimangono dentro il riquadro. I controlli ereditano i temi esistenti.

### Modali custom

Nella build online alert, confirm e prompt vengono sostituiti da dialoghi nello stile dell'app. Sono inclusi conferme di eliminazione, importazioni, cambio cartella, conferma del backup e testo di conferma del ripristino. I dialoghi gestiscono focus, navigazione da tastiera, Escape e accodamento delle richieste.

Il riquadro degli errori della cartella è nascosto finché non contiene un messaggio e non occupa spazio. Le azioni di gestione della cartella cambiano in base allo stato, evitando pulsanti ridondanti.

### Dati e documenti

- Allegati JPG, PNG, WEBP e PDF; PDF degli estratti conto.
- Backup completo ZIP con archivio, documenti e manifest SHA-256.
- Controlli su checksum, dimensioni, nomi ZIP e documenti prima del ripristino.
- Importazione CSV/XLSX con anteprima e mappatura esistenti.
- Service worker per le risorse dell'app e apertura offline; online vengono preferite le risorse aggiornate.

Le copie IndexedDB di recupero non sostituiscono un backup esterno. Anche un file locale richiede una seconda copia per proteggersi da guasto o perdita del dispositivo.

---

## Verifiche e stato di consegna

**11 test automatizzati superati.** La suite copre conflitti fra schede, allegati, backup e checksum, ripristino, CSV/XLSX, policy Drive con API simulate, aggiornamento dello stesso file remoto, pulizia selettiva, cache offline, cartella locale e avvio dell'interfaccia in jsdom. I dialoghi custom sono verificati nel flusso iPhone e con test dedicati a Escape, focus, inserimento del testo e accodamento.

La sintassi degli script generati è stata controllata. La build è disponibile in dist/online, separata dalla build Windows. I test della versione online si eseguono localmente con npm test; il workflow GitHub esistente rimane invariato.

Restano da eseguire prove su browser e dispositivi reali: Android, iPhone, PC, autorizzazioni alle cartelle, dialoghi Google, aggiornamenti condizionali Drive, download in File e installazione PWA. Il browser di verifica della sessione non era disponibile. I test simulati non costituiscono una certificazione di questi flussi.

## Spunti per i prossimi sviluppi

- **Priorità alta:** collaudo reale completo con due dispositivi, un account Google e modifiche concorrenti; verifica dell'aggiornamento condizionale e della pulizia.
- **Priorità alta:** verificare errori di disco, permessi revocati e interruzioni durante la scrittura. Mantenere sempre distinguibili modifiche in memoria e salvataggi duraturi.
- **Priorità alta:** predisporre e verificare hosting HTTPS e origini OAuth autorizzate; nessuna pubblicazione automatica è stata eseguita.
- **Priorità media:** completare la parità delle validazioni contabili con Go e rendere accessibili le copie locali di recupero.
- **Priorità media:** migliorare l'identità dell'account collegato e introdurre un flusso esplicito di scollegamento o cambio account.
- **Evoluzione:** condivisione fra account diversi, selezione dei file con Google Picker e risoluzione dei conflitti a livello di record.

---

## Avviare l'applicazione dai sorgenti

### Procedura semplice su Windows

1. Installa **Node.js 20 o successivo**, se non è già presente. Node.js comprende npm. Dopo l'installazione chiudi e riapri eventuali terminali.
2. Apri la cartella principale del progetto, quella che contiene README.md, desktop, online e scripts.
3. Fai doppio clic su **AVVIA_QUADRA_ONLINE.cmd**. Non serve installare Go per questa versione.
4. Al primo avvio lo script scarica le dipendenze: serve una connessione Internet. Le volte successive le riutilizza e prepara nuovamente la build.
5. Quando compare l'indirizzo, apri **http://127.0.0.1:8080** nel browser dello stesso PC.
6. Lascia aperta la finestra dello script mentre usi Quadra. Per fermare il server premi **Ctrl+C**; se Windows chiede conferma, conferma l'interruzione.

Lo script avvia la versione web/PWA di questo ramo. Non avvia l'eseguibile desktop Go. Il salvataggio segue la modalità scelta nell'app: Google Drive oppure cartella locale; avviare lo script non seleziona automaticamente un archivio.

### Aggiornamenti ed errori frequenti

- **Dopo modifiche al codice:** ferma il server e rilancia lo script per rigenerare la build. Nel browser ricarica con Ctrl+Shift+R.
- **Node.js non trovato:** installalo da https://nodejs.org/ e riavvia lo script.
- **Porta 8080 occupata:** probabilmente Quadra è già aperta in un'altra finestra. Usa quella sessione oppure chiudila prima di riprovare.
- **Installazione dipendenze non riuscita:** controlla la connessione. Lo script mantiene visibile il messaggio di errore.
- **Dipendenze cambiate nel repository:** esegui npm ci --ignore-scripts dalla cartella online, poi rilancia lo script.

### Telefono e versione desktop

L'indirizzo 127.0.0.1 funziona sul PC che esegue lo script. Per usare la PWA dal telefono occorre pubblicare la build su un indirizzo HTTPS: lo script non pubblica il sito e non rende il PC raggiungibile da Internet.

Per la versione desktop originale servono invece Go 1.22 o successivo e i comandi descritti nel README principale. I due avvii non vanno confusi.

### Test e riferimenti

Per eseguire i test, dopo la build apri un terminale nella cartella online e lancia **npm test**. Le istruzioni tecniche complete sono in docs/ONLINE_VERSION.md.

Per i dettagli tecnici consultare docs/ONLINE_VERSION.md. Questo documento fotografa lo stato di sviluppo del ramo al 27 novembre 2026 e non dichiara completato il collaudo in produzione.

---

## Google Cloud: configurazione di test e sostituzione

### Configurazione attualmente utilizzata

La versione online usa al momento un progetto Google Cloud personale, creato dal proprietario di Quadra esclusivamente per provare il collegamento con Google Drive. Non è una configurazione di produzione né un servizio cloud che ospita l'archivio di tutti: i file vengono salvati nel Drive dell'account che accede. Il progetto identifica l'app e le autorizzazioni OAuth.

Il Client ID pubblico attivo si trova in **online/google-config.js**, nella proprietà **clientId**. La configurazione attuale non viene modificata da questa guida.

### Creare una nuova configurazione di test

1. Apri https://console.cloud.google.com/ con l'account che gestirà il nuovo ambiente e crea un progetto, ad esempio **Quadra - Test 2**.
2. Nel progetto selezionato, apri **API e servizi > Libreria**, cerca **Google Drive API** e abilitala.
3. In **Google Auth Platform > Branding**, configura nome dell'app, email di assistenza e contatto. In **Audience**, scegli **Esterno**, mantieni la modalità **Test** e aggiungi gli account che userai alle persone autorizzate al test.
4. In **Data Access**, configura lo scope **https://www.googleapis.com/auth/drive.file**, usato da Quadra per i file autorizzati all'app.
5. In **Clients**, crea un client di tipo **Applicazione web**. Nelle origini JavaScript autorizzate inserisci **http://127.0.0.1:8080** e **http://localhost:8080**. Aggiungi l'origine HTTPS quando pubblicherai il sito. Autorizza separatamente eventuali porte di prova diverse.
6. Copia il nuovo **Client ID OAuth**, che termina con **.apps.googleusercontent.com**. Il flusso popup usato da Quadra non richiede URI di reindirizzamento. Non inserire client secret o token nel codice del browser.

### Puntare Quadra al nuovo progetto

Prima del cambio esporta un backup completo ZIP dall'app. Poi modifica **online/google-config.js**. Sostituisci clientId con il valore appena ottenuto; per un ambiente di test separato assegna anche un nuovo workspace, evitando di riutilizzare i riferimenti locali del progetto precedente.

```javascript
window.QuadraGoogleConfig = Object.freeze({
  clientId: 'NUOVO_CLIENT_ID.apps.googleusercontent.com',
  workspace: 'quadra-test-02'
});
```

Ferma il server e rilancia **AVVIA_QUADRA_ONLINE.cmd**, poi ricarica con **Ctrl+Shift+R**. Premi **Accedi con Google**, usa un account incluso negli utenti di test e concedi il nuovo consenso. Prova una modifica e una sincronizzazione: i caricamenti successivi devono aggiornare lo stesso Quadra.zip nel nuovo spazio.

Il cambio progetto non migra automaticamente i file del vecchio ambiente: le proprietà private e le autorizzazioni drive.file dipendono dall'app. Conserva il vecchio ZIP finché non hai verificato il nuovo spazio. Per provare anche un account Google diverso, usa un profilo browser separato, così non mescoli l'archivio locale associato all'altro account.

Riferimenti ufficiali: https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid e https://developers.google.com/workspace/drive/api/quickstart/js.
