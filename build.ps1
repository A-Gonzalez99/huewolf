# Builds the extension (extension/ folder) into huewolf.xpi.
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$src  = Join-Path $root "extension"
$out  = Join-Path $root "huewolf.xpi"
if (Test-Path $out) { Remove-Item $out }

$zip = [System.IO.Compression.ZipFile]::Open($out, "Create")
try {
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    # Paths inside the .xpi must use "/" (Firefox rejects "\").
    $name = $_.FullName.Substring($src.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name, "Optimal") | Out-Null
  }
} finally {
  $zip.Dispose()
}
Write-Host "OK -> $out"
