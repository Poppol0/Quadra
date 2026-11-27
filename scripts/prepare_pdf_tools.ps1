# Pure-Python dependencies are downloaded to ignored build storage, not installed globally.
$ErrorActionPreference = 'Stop'
$pdfTarget = Join-Path $PSScriptRoot '../dist/pdf-tools'
New-Item -ItemType Directory -Force -Path $pdfTarget | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($pdfPackage in @(@('reportlab','4.4.9'), @('pypdf','6.4.0'), @('charset-normalizer','3.4.4'))) {
    $pdfMetadata = Invoke-RestMethod -Uri "https://pypi.org/pypi/$($pdfPackage[0])/$($pdfPackage[1])/json"
    $pdfWheel = $pdfMetadata.urls | Where-Object { $_.filename.EndsWith('py3-none-any.whl') } | Select-Object -First 1
    if (-not $pdfWheel) { throw 'Pure Python wheel not found' }
    $pdfArchive = Join-Path $pdfTarget $pdfWheel.filename
    Invoke-WebRequest -UseBasicParsing -Uri $pdfWheel.url -OutFile $pdfArchive
    if ((Get-FileHash -LiteralPath $pdfArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pdfWheel.digests.sha256) { throw 'Wheel checksum mismatch' }
    $pdfZip = [System.IO.Compression.ZipFile]::OpenRead($pdfArchive)
    try {
        foreach ($pdfEntry in $pdfZip.Entries) {
            $pdfOutput = [System.IO.Path]::GetFullPath((Join-Path $pdfTarget $pdfEntry.FullName))
            if (-not $pdfOutput.StartsWith([System.IO.Path]::GetFullPath($pdfTarget) + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Invalid wheel path' }
            if ($pdfEntry.Name) {
                New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($pdfOutput)) | Out-Null
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($pdfEntry,$pdfOutput,$true)
            }
        }
    } finally { $pdfZip.Dispose() }
    Write-Output "$($pdfPackage[0]) $($pdfPackage[1]) ready"
}
