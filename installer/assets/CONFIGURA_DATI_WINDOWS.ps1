# Quadra: sceglie una cartella dati privata, senza spostare automaticamente gli archivi.
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Seleziona la cartella dati di Quadra (esegui prima un backup completo ZIP).'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Operazione annullata. Nessuna modifica.'
    exit 0
}
$folder = [System.IO.Path]::GetFullPath($dialog.SelectedPath)
$program = [System.IO.Path]::GetFullPath($PSScriptRoot)
if ($folder.TrimEnd('\') -eq $program.TrimEnd('\') -or $folder.StartsWith($program.TrimEnd('\') + '\',[System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host 'Errore: i dati non possono stare dentro la cartella del programma.'
    exit 1
}
$msg = "La nuova cartella: $folder`n`nNON ricevera automaticamente i dati precedenti. Prima crea un backup ZIP completo e ripristinalo dopo aver cambiato cartella. Continuare?"
$answer = [System.Windows.Forms.MessageBox]::Show($msg,'Quadra - Cambio cartella dati',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning)
if ($answer -ne [System.Windows.Forms.DialogResult]::Yes){exit 0}
$targetDir = Join-Path $env:APPDATA 'Quadra'
[System.IO.Directory]::CreateDirectory($targetDir) | Out-Null
# Preserve an independently configured backup directory.
$currentConfig = Join-Path $targetDir 'config.json'
$preferences = @{data_dir=$folder}
if (Test-Path $currentConfig) {
    try {
        $old = Get-Content -Raw -Encoding UTF8 $currentConfig | ConvertFrom-Json
        if ($old.backup_dir) { $preferences.backup_dir = $old.backup_dir }
    } catch { Write-Host 'Avviso: configurazione precedente non leggibile.' }
}
$json = $preferences | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $targetDir 'config.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Percorso dati configurato: $folder"
Write-Host 'Riavvia Quadra e ripristina il backup completo ZIP se necessario.'
