@echo off
setlocal
set "QUADRA_FOLDER=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:QUADRA_FOLDER; $shell=New-Object -ComObject WScript.Shell; $s=$shell.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Quadra.lnk')); $s.TargetPath=[IO.Path]::Combine($p,'Quadra.exe'); $s.WorkingDirectory=$p; $s.IconLocation=[IO.Path]::Combine($p,'Quadra.ico')+',0'; $s.Description='Quadra - I conti di casa, in ordine'; $s.Save(); Write-Host 'Collegamento Quadra creato sul Desktop.'"
if errorlevel 1 (echo Impossibile creare il collegamento.)
pause
