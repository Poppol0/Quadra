@echo off
setlocal
cd /d "%~dp0"
title Quadra - versione online
if not defined QUADRA_PORT set "QUADRA_PORT=8080"
echo.
echo  QUADRA - Avvio versione web / PWA
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installa Node.js 20 o successivo da https://nodejs.org/
  echo Poi chiudi questa finestra e avvia nuovamente questo file.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if errorlevel 1 (
  echo Serve Node.js 20 o successivo. Aggiornalo da https://nodejs.org/
  pause
  exit /b 1
)
if not exist "online\node_modules\fflate\package.json" goto install
if not exist "online\node_modules\xlsx\package.json" goto install
goto build

:install
echo Installazione delle dipendenze. Al primo avvio serve Internet.
where npm >nul 2>nul
if errorlevel 1 goto failure
pushd online
call npm ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  popd
  goto failure
)
popd

:build
echo Preparazione dell'applicazione...
node scripts\build_online.mjs
if errorlevel 1 goto failure
echo.
echo Apri nel browser: http://127.0.0.1:%QUADRA_PORT%
echo Lascia aperta questa finestra. Per fermare Quadra premi Ctrl+C.
echo Per utilizzare il telefono serve la pubblicazione su HTTPS.
echo.
node scripts\serve_online.mjs
if errorlevel 1 goto failure
exit /b 0

:failure
echo.
echo Avvio non riuscito. Leggi il messaggio di errore sopra.
echo Se la porta %QUADRA_PORT% e' occupata, chiudi l'altra sessione di Quadra.
pause
exit /b 1
