# Evoluzione del progetto

Il progetto e stato inizialmente sviluppato come app web locale, poi unificato sotto il nome **Quadra**. Le funzioni principali sono:

- registrazione movimenti e classificazione tramite categorie;
- conti, saldi, esercizi annuali e riconciliazione;
- scadenze, ricorrenze, finanziamenti e rate da confermare;
- importazione Excel/CSV con controllo dei duplicati;
- allegati di ricevute e documenti, backup completo ZIP;
- temi grafici personalizzabili e calendario esportabile `.ics`;
- cartella dati separata e versione desktop Windows autonoma;
- installer per utente corrente.

Questa repository nasce dal **codice sorgente della versione desktop e dell'installer**, mantenendo il vecchio backend Python nella cartella `legacy-python` come riferimento. Non vengono inclusi archivi familiari storici o binari compilati.

## 1.1 - Correzioni interfaccia e percorsi locali

- Selettore del trimestre senza ritorno a capo in Panoramica e Bilanci annuali;
  controllo abbreviato negli schermi mobili.
- Nuova icona a salvadanaio per Budget.
- Impostazioni ordinate: categorie, notifiche, ripristino/unione JSON,
  esportazione/Calendar, aspetto/cartelle dati.
- Scelta della cartella dati e della cartella backup dall'interfaccia Desktop,
  con copia verificata dei file e conservazione dell'originale.
- Backup ZIP completi salvabili direttamente nella cartella backup selezionata.

## 1.1.1 - Navigazione mobile

- Barra inferiore: Panoramica, Movimenti, pulsante + centrale rialzato, Calendario, Altro.
- Il pulsante + apre il modulo del nuovo movimento; Calendario apre scadenze e rate.
- Conti e Bilanci annuali restano accessibili dal menu Altro.
- L'interfaccia desktop a schermo largo rimane invariata.
- Il motore resta locale; accesso remoto e sincronizzazione online non sono ancora disponibili.
