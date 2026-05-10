$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

$zip = Join-Path $PWD 'yandex-snake-upload.zip'
if (Test-Path $zip) {
    Remove-Item $zip -Force
}

Compress-Archive `
    -Path @('index.html', 'style.css', 'game.bundle.js', 'assets') `
    -DestinationPath $zip `
    -CompressionLevel Optimal `
    -Force

Write-Host "Created: $zip"
