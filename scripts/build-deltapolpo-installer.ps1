# Builds the DeltaPolpo Windows installer (ui/release/DeltaPolpo-Setup-<version>.exe).
# Every build raises the last number of the version in scripts/deltapolpo-version.txt by one.
#
# Same pipeline as the upstream desktop release (.github/workflows/desktop-check.yml), for Windows:
#   1. build the workspace packages and the server (dist/)
#   2. build the UI for Electron, pointed at the DeltaPolpo server port (3891)
#   3. compile the server into ui/binaries/polpo-server.exe with Bun (ui/binaries/build-sidecar.sh)
#   4. package the Electron app and the NSIS installer with electron-builder
#
# Requirements: Node.js, pnpm, Git for Windows (bash). Bun is installed locally into
# .deltapolpo-tools/ on first run if it is not on PATH.
#
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File scripts\build-deltapolpo-installer.ps1

$ErrorActionPreference = "Stop"
$BunVersion = "1.4.2"
$ServerPort = 3891

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

# ── Tools ────────────────────────────────────────────────────────────

Step "Checking tools"
foreach ($tool in @("node", "pnpm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not found on PATH" }
}
# Git Bash, not C:\Windows\System32\bash.exe (the WSL launcher, which may have no distribution).
$BashPath = $null
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    $gitRoot = Split-Path (Split-Path $git.Source -Parent) -Parent
    foreach ($candidate in @("bin\bash.exe", "usr\bin\bash.exe")) {
        $p = Join-Path $gitRoot $candidate
        if (Test-Path $p) { $BashPath = $p; break }
    }
}
if (-not $BashPath -and (Test-Path "C:\Program Files\Git\bin\bash.exe")) { $BashPath = "C:\Program Files\Git\bin\bash.exe" }
if (-not $BashPath) { throw "Git Bash not found: install Git for Windows" }
Write-Host "bash: $BashPath"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    $ToolsDir = Join-Path $Root ".deltapolpo-tools"
    $LocalBun = Join-Path $ToolsDir "node_modules\.bin"
    if (-not (Test-Path (Join-Path $LocalBun "bun.exe")) -and -not (Test-Path (Join-Path $LocalBun "bun.cmd"))) {
        Write-Host "Installing Bun $BunVersion into $ToolsDir"
        New-Item -ItemType Directory -Force $ToolsDir | Out-Null
        Run "npm" @("install", "--prefix", $ToolsDir, "--no-save", "--no-audit", "--no-fund", "bun@$BunVersion")
    }
    $env:PATH = "$LocalBun;$env:PATH"
}
Write-Host "node $(node --version), pnpm $(pnpm --version), bun $(bun --version)"

# Each installer gets the next version: the last number of scripts/deltapolpo-version.txt goes up by
# one, saved only once the installer is built. Kept apart from package.json (Polpo's own version).
$VersionFile = Join-Path $PSScriptRoot "deltapolpo-version.txt"
$PreviousVersion = (Get-Content $VersionFile -Raw).Trim()
if ($PreviousVersion -notmatch '^(\d+(?:\.\d+)*)\.(\d+)$') { throw "Unreadable version in ${VersionFile}: '$PreviousVersion'" }
$Version = "$($Matches[1]).$([int]$Matches[2] + 1)"
Write-Host "DeltaPolpo version $Version (previous installer: $PreviousVersion)"

# ── 1. Packages and server ──────────────────────────────────────────

Step "Building packages and server"
foreach ($pkg in @("@polpo-ai/vault-crypto", "@polpo-ai/core", "@polpo-ai/drizzle", "@polpo-ai/server", "@polpo-ai/sdk")) {
    Run "pnpm" @("--filter", $pkg, "build")
}
Run "pnpm" @("exec", "tsc")
Run "pnpm" @("--filter", "@polpo-ai/react", "build")

# ── 2. UI for Electron ──────────────────────────────────────────────

Step "Building the UI (server on port $ServerPort)"
$env:POLPO_ELECTRON = "1"
$env:VITE_POLPO_API_URL = "http://localhost:$ServerPort"
Push-Location ui
try { Run "pnpm" @("exec", "vite", "build") } finally { Pop-Location }
Remove-Item Env:POLPO_ELECTRON, Env:VITE_POLPO_API_URL

# ── 3. Server sidecar ───────────────────────────────────────────────

Step "Compiling the server into ui\binaries\polpo-server.exe"
Run $BashPath @("ui/binaries/build-sidecar.sh")

# ── 4. Installer ────────────────────────────────────────────────────

Step "Packaging the installer"
# electron-builder needs its winCodeSign tools (rcedit sets the exe icon and version). The archive
# also holds two macOS symlinks that Windows refuses to create without Developer Mode, and the
# extraction then fails. They are not used on Windows: extract the rest into the cache ourselves.
$WinCodeSign = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
$WinCodeSignDir = Join-Path $WinCodeSign "winCodeSign-2.6.0"
if (-not (Test-Path (Join-Path $WinCodeSignDir "rcedit-x64.exe"))) {
    $SevenZip = Get-ChildItem (Join-Path $Root "node_modules\.pnpm") -Directory -Filter "7zip-bin@*" |
        ForEach-Object { Join-Path $_.FullName "node_modules\7zip-bin\win\x64\7za.exe" } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $SevenZip) { throw "7za.exe (7zip-bin) not found in node_modules" }
    New-Item -ItemType Directory -Force $WinCodeSign | Out-Null
    $Archive = Join-Path $WinCodeSign "winCodeSign-2.6.0.7z"
    if (-not (Test-Path $Archive)) {
        Invoke-WebRequest -UseBasicParsing -OutFile $Archive `
            -Uri "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
    }
    & $SevenZip x -bd -y "-o$WinCodeSignDir" $Archive | Out-Null   # exit code 2: the two macOS symlinks
    if (-not (Test-Path (Join-Path $WinCodeSignDir "rcedit-x64.exe"))) { throw "Could not extract winCodeSign" }
    # Leftovers of extraction attempts electron-builder made itself (random numeric names)
    Get-ChildItem $WinCodeSign | Where-Object { $_.Name -match '^\d+(\.7z)?$' } | Remove-Item -Recurse -Force
}
# A DeltaPolpo still running from a previous build would lock its files.
Get-Process -Name "DeltaPolpo", "polpo-server" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$Root*" } | Stop-Process -Force
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Push-Location ui
try {
    Run "pnpm" @("exec", "electron-builder", "--win", "nsis", "--publish", "never", "--config.extraMetadata.version=$Version")
} finally { Pop-Location }

$Installer = Join-Path $Root "ui\release\DeltaPolpo-Setup-$Version.exe"
if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }
Set-Content -Path $VersionFile -Value $Version -Encoding ascii
Write-Host ""
Write-Host "Installer ready: $Installer" -ForegroundColor Green
Write-Host ("Size: {0:N0} MB" -f ((Get-Item $Installer).Length / 1MB))
