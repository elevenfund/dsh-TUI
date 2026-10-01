# One-shot installer for the elevenfund fork of dsh-tui (Windows).
# Usage (PowerShell):
#   irm https://github.com/elevenfund/dsh-TUI/releases/download/v0.12.0-e1/install.ps1 | iex
#
# What it does:
#   1. npm install -g the pinned dsh engine plus the fork TUI tarball.
#   2. Strip the nested @deepseek-ai copies npm may plant inside the TUI
#      package (stale engine-line packages that shadow the real engine and
#      break module loading with missing exports).
#   3. Point the dsh-tui profile manifest at the fork tarball and sync the
#      profile-local package body (with its dependency tree) from the global
#      install, so `dsh --profile dsh-tui` never falls back to the registry
#      build of the same name+version.
$ErrorActionPreference = 'Stop'

$ReleaseBase = 'https://github.com/elevenfund/dsh-TUI/releases/download/v0.12.0-e1'
$Tarball = "$ReleaseBase/elevenfund-dsh-tui-0.12.0.tgz"
$EngineVersion = '0.2.0-rc.2'
$TuiName = '@deepseek-harness-tui/dsh-tui'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step 'Installing dsh engine + fork TUI (npm install -g)'
npm install -g "@deepseek-ai/dsh@$EngineVersion" $Tarball
if ($LASTEXITCODE -ne 0) { throw 'npm install -g failed' }

$globalRoot = npm root -g
$globalTui = Join-Path $globalRoot "@deepseek-harness-tui/dsh-tui"

if (-not (Test-Path (Join-Path $globalTui 'lib'))) { throw "TUI not found at $globalTui" }

Step 'Removing nested engine-line packages inside the TUI install'
# npm sometimes nests its own @deepseek-ai resolution (stale engine-line
# versions) inside the TUI package. The engine supplies these at runtime;
# nested copies shadow it and break module loading.
$nestedDeepseek = Join-Path $globalTui 'node_modules/@deepseek-ai'
if (Test-Path $nestedDeepseek) {
  Remove-Item -Recurse -Force $nestedDeepseek
  Write-Host "  removed $nestedDeepseek"
} else {
  Write-Host '  none present (clean)'
}

Step 'Configuring the dsh-tui profile'
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\dsh-tui'
$profileModules = Join-Path $profileDir 'node_modules'
$profileTui = Join-Path $profileModules '@deepseek-harness-tui\dsh-tui'
$manifestPath = Join-Path $profileDir 'package.json'

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

# Manifest: dependency pinned to the fork tarball so /update and reinstalls
# resolve the fork, never the same-named registry build.
$manifest = $null
if (Test-Path $manifestPath) {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  Copy-Item $manifestPath "$manifestPath.bak-pre-fork" -Force
}
if ($null -eq $manifest) {
  $manifest = [pscustomobject]@{
    name        = 'dsh-profile-dsh-tui'
    private     = $true
    dependencies = [pscustomobject]@{}
    dsh         = [pscustomobject]@{ profile = [pscustomobject]@{ bundles = @('@deepseek-ai/dsh-base', $TuiName) } }
  }
}
if (-not $manifest.dependencies) {
  $manifest | Add-Member -MemberType NoteProperty -Name dependencies -Value ([pscustomobject]@{})
}
if ($manifest.dependencies.PSObject.Properties[$TuiName]) {
  $manifest.dependencies.PSObject.Properties[$TuiName].Value = $Tarball
} else {
  $manifest.dependencies | Add-Member -MemberType NoteProperty -Name $TuiName -Value $Tarball
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8
Write-Host "  manifest dependency -> $Tarball"

# Package body: copy the global fork install (with its dependency tree) into
# the profile so profile launches load the fork without any registry access.
New-Item -ItemType Directory -Force -Path (Split-Path $profileTui -Parent) | Out-Null
if (Test-Path $profileTui) { Remove-Item -Recurse -Force $profileTui }
Copy-Item -Recurse $globalTui $profileTui
Write-Host "  profile-local TUI synced from global install"

# Belt and braces: the copy may have raced with step 2; strip again.
$profileNested = Join-Path $profileTui 'node_modules/@deepseek-ai'
if (Test-Path $profileNested) { Remove-Item -Recurse -Force $profileNested }

Step 'Verifying fork markers'
foreach ($marker in @('lib\types\screens\chat\use-migrate.js', 'lib\types\components\TaskCenterPanel.js')) {
  if (-not (Test-Path (Join-Path $profileTui $marker))) { throw "fork marker missing: $marker" }
}
Write-Host '  use-migrate + TaskCenterPanel present: fork confirmed'

Write-Host ''
Write-Host 'Install complete. Start with:' -ForegroundColor Green
Write-Host '  dsh-tui            (or: dsh --profile dsh-tui)'
Write-Host '  Ctrl+G opens the task center; /migrate exists only in this fork.'
