<#
.SYNOPSIS
  One-stop helper for building and running Blockhold Launcher.

.DESCRIPTION
  Run with no arguments for an interactive menu, or pass a command:

    .\build.ps1 run        Build and start the launcher (dev run)
    .\build.ps1 check      Typecheck + unit tests
    .\build.ps1 smoke      Full build + automated in-app smoke test
    .\build.ps1 exe        Build the installer AND portable .exe (default release)
    .\build.ps1 installer  Build only the NSIS installer .exe
    .\build.ps1 portable   Build only the portable .exe
    .\build.ps1 unpacked   Build an unpacked app folder (fastest packaging, for testing)
    .\build.ps1 release    check, then exe (what you want before sharing a build)
    .\build.ps1 clean      Delete build output (dist/, smoke-out/, packaged files here)

  Options:
    -Open        Open this folder in Explorer after packaging
    -SkipChecks  With 'release': skip typecheck/tests

  If PowerShell refuses to run scripts, use:
    powershell -ExecutionPolicy Bypass -File .\release\build.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('', 'run', 'check', 'smoke', 'exe', 'installer', 'portable', 'unpacked', 'release', 'clean', 'menu')]
  [string]$Command = '',
  [switch]$Open,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$ReleaseDir = $PSScriptRoot
$ProjectDir = Split-Path -Parent $ReleaseDir

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Bad([string]$msg) { Write-Host "  !!  $msg" -ForegroundColor Red }

# Run a command in the project folder and stop the script if it fails.
function Invoke-Npm([string[]]$NpmArgs) {
  Write-Host "  > npm $($NpmArgs -join ' ')" -ForegroundColor DarkGray
  Push-Location $ProjectDir
  try {
    & npm @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed (exit code $LASTEXITCODE)" }
  } finally { Pop-Location }
}

function Assert-Tools {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed or not on PATH. Get it from https://nodejs.org' }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is not on PATH.' }
  if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) {
    Write-Step 'Installing dependencies (first run)'
    Invoke-Npm @('install')
  }
}

# A running copy locks files in win-unpacked and makes packaging fail.
function Stop-RunningLauncher {
  $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -like 'Blockhold*' -or ($_.Path -and $_.Path -like "$ReleaseDir*")
  }
  if ($procs) {
    Write-Step 'Closing running Blockhold Launcher so its files can be replaced'
    $procs | Stop-Process -Force
    Start-Sleep -Milliseconds 800
  }
}

function Show-Artifacts {
  Write-Step 'Build output'
  $files = Get-ChildItem $ReleaseDir -File -Filter *.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if (-not $files) { Write-Host '  (no .exe files)'; return }
  foreach ($f in $files) {
    Write-Host ('  {0,-48} {1,8:N1} MB   {2}' -f $f.Name, ($f.Length / 1MB), $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
  }
  if ($Open) { Invoke-Item $ReleaseDir }
}

function Invoke-Check {
  Write-Step 'Typecheck'
  Invoke-Npm @('run', 'typecheck')
  Write-Ok 'types are clean'
  Write-Step 'Unit tests'
  Invoke-Npm @('test')
  Write-Ok 'tests pass'
}

function Invoke-Package([string[]]$Targets) {
  Stop-RunningLauncher
  Write-Step "Building app + packaging ($($Targets -join ', '))"
  Invoke-Npm @('run', 'build')
  Invoke-Npm (@('exec', '--', 'electron-builder', '--win') + $Targets)
  Write-Ok 'packaged'
  Show-Artifacts
}

function Invoke-Clean {
  Stop-RunningLauncher
  Write-Step 'Cleaning build output'
  $targets = @(
    (Join-Path $ProjectDir 'dist'),
    (Join-Path $ProjectDir 'smoke-out'),
    (Join-Path $ReleaseDir 'win-unpacked')
  )
  foreach ($t in $targets) { if (Test-Path $t) { Remove-Item $t -Recurse -Force; Write-Ok "removed $t" } }
  # packaged files only: never this script
  Get-ChildItem $ReleaseDir -File | Where-Object { $_.Extension -in '.exe', '.blockmap', '.yml', '.yaml' } |
    ForEach-Object { Remove-Item $_.FullName -Force; Write-Ok "removed $($_.Name)" }
}

function Invoke-BuildCommand([string]$cmd) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  switch ($cmd) {
    'run'       { Write-Step 'Building and starting the launcher'; Invoke-Npm @('start') }
    'check'     { Invoke-Check }
    'smoke'     { Write-Step 'Smoke test (builds, launches the app, drives it, screenshots to smoke-out/)'; Invoke-Npm @('run', 'smoke') }
    'exe'       { Invoke-Package @('nsis', 'portable') }
    'installer' { Invoke-Package @('nsis') }
    'portable'  { Invoke-Package @('portable') }
    'unpacked'  { Invoke-Package @('dir') }
    'release'   { if (-not $SkipChecks) { Invoke-Check }; Invoke-Package @('nsis', 'portable') }
    'clean'     { Invoke-Clean }
  }
  $sw.Stop()
  Write-Host ("`nDone in {0:N0}s." -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
}

function Show-Menu {
  $items = [ordered]@{
    '1' = @('run', 'Build and start the launcher')
    '2' = @('check', 'Typecheck + unit tests')
    '3' = @('smoke', 'Full smoke test in the real app')
    '4' = @('exe', 'Build installer + portable .exe')
    '5' = @('release', 'Checks, then installer + portable .exe')
    '6' = @('portable', 'Portable .exe only')
    '7' = @('installer', 'Installer .exe only')
    '8' = @('unpacked', 'Unpacked folder (quick packaging test)')
    '9' = @('clean', 'Delete build output')
  }
  Write-Host "`nBlockhold Launcher - build helper" -ForegroundColor Yellow
  Write-Host "Project: $ProjectDir`n" -ForegroundColor DarkGray
  foreach ($k in $items.Keys) { Write-Host ('  [{0}] {1,-10} {2}' -f $k, $items[$k][0], $items[$k][1]) }
  Write-Host '  [q] quit'
  $choice = Read-Host "`nChoose"
  if ($choice -eq 'q' -or [string]::IsNullOrWhiteSpace($choice)) { return $null }
  if (-not $items.Contains($choice)) { Write-Bad "Unknown choice '$choice'"; return $null }
  return $items[$choice][0]
}

try {
  Assert-Tools
  if (-not $Command -or $Command -eq 'menu') { $Command = Show-Menu; if (-not $Command) { exit 0 } }
  Invoke-BuildCommand $Command
  exit 0
} catch {
  Write-Bad $_.Exception.Message
  exit 1
}
