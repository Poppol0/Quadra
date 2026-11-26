# Sicurezza e dati personali

Questa repository non deve contenere dati reali delle persone che usano Quadra.

## Non committare

- `archivio.json` con movimenti, conti, importi o intestatari.
- Foto di scontrini, ricevute, estratti conto PDF, screenshot bancari.
- Backup ZIP completi dell'applicazione, file di esportazione Excel/CSV con transazioni.
- Credenziali, password, token API, file `.env` o chiavi private.
- Log con dati identificativi.

`.gitignore` riduce il rischio, ma **non sostituisce la revisione** del contenuto di ogni commit (`git status` e `git diff --cached`). In particolare, gli allegati caricati in altri percorsi devono essere esclusi manualmente.

## Backup

I backup completi si conservano su unità personali, non nel repository. Il trasferimento tra installazioni deve avvenire mediante i comandi di backup e ripristino dell'app e con controlli sugli allegati.

## Desktop locale

Quadra espone le proprie API solo sulla macchina locale. Non mettere direttamente il server in ascolto su Internet senza autenticazione, autorizzazione e hardening specifici.
