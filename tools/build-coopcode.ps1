# Build sob demanda do CoopCode e instalacao isolada fora do repo.
#
# Uso:
#   rtk powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-coopcode.ps1
#
# Resultado: C:\Dev2026\builds\coopcode\CoopCode.cmd inicia a build instalada
# com o OpenCode ARM64 fixado no PATH. Nada aqui roda automaticamente.

$ErrorActionPreference = 'Stop'

$repo       = Split-Path -Parent $PSScriptRoot
$orca       = Join-Path $repo 'apps\desktop\orca'
$unpacked   = Join-Path $orca 'dist\win-arm64-unpacked'

# Resolve o diretorio parent que contem external_repos, mesmo quando
# executado de uma worktree: o .git file aponta para o repo principal
# e external_repos fica como irmao dele.
$gitFile    = Join-Path $repo '.git'
$parentDir  = Split-Path -Parent $repo
if (Test-Path $gitFile -PathType Leaf) {
  $gitDir = Get-Content $gitFile | ForEach-Object { if ($_ -match '^gitdir:\s*(.+)$') { $matches[1] } }
  if ($gitDir) {
    $mainRepo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $gitDir)))
    if (Test-Path (Join-Path $mainRepo 'external_repos')) { $parentDir = $mainRepo }
  }
}
$opencode   = Join-Path $parentDir 'external_repos\opencode\packages\opencode\dist\opencode-windows-arm64\bin\opencode.exe'
$install    = 'C:\Dev2026\builds\coopcode'
$current    = Join-Path $install 'current'
$previous   = Join-Path $install 'previous'

if (-not (Test-Path $opencode)) { throw "OpenCode ARM64 nao encontrado: $opencode" }

# Build: o --dir final e do electron-builder e gera apenas o unpacked (sem NSIS).
# Comando identico ao registrado em docs/planning/evidence/PLAT-009.md.
# O rebuild nativo do node-pty monta caminhos de 263 chars, e o MSBuild corta em
# 260 (MSB3491). O estouro vem do nome do diretorio da store virtual do pnpm
# ("node-pty@1.1.0_patch_hash=<hash>", 60 chars). Limitar esse nome a 30 derruba
# o caminho para ~233. So tem efeito no install, e o valor vale pelo env var
# porque nao existe flag de CLI para ele — e assim nao editamos o .npmrc do Orca.
# ponytail: subst nao resolve, realpath desfaz a unidade virtual e volta ao C:.
$env:npm_config_virtual_store_dir_max_length = '30'

# O limite acima so vale para instalacoes novas: numa arvore ja instalada o nome
# longo continua no disco, e o electron-builder forca um rebuild do node-pty que
# volta a estourar o MSB3491. Sem --force, rebuild-native-deps.mjs sonda se os
# modulos ja carregam no Electron e so reconstroi se precisar. O guard em
# electron-builder-native-rebuild.cjs exige plataforma/arch iguais aos do host,
# entao isso nunca pula um cross-compile. O workflow de PR ja usa o mesmo valor.
$env:ORCA_REUSE_PREPARED_NATIVE_RUNTIME = '1'

Push-Location $orca
try {
  if (-not (Test-Path (Join-Path $orca 'node_modules'))) {
    & (Join-Path $PSScriptRoot 'pnpm-arm64.cmd') install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install falhou com exit $LASTEXITCODE" }
  }
  & (Join-Path $PSScriptRoot 'pnpm-arm64.cmd') run build:win -- --arm64 --dir
  if ($LASTEXITCODE -ne 0) { throw "build:win falhou com exit $LASTEXITCODE" }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $unpacked 'Orca.exe'))) { throw "Orca.exe nao encontrado em $unpacked" }

# ponytail: exatamente uma build anterior e mantida. Se um dia precisares comparar
# tres versoes, troca a rotacao por um sufixo de data e um corte por contagem.
# Retry para file locks (scanner, indexador do Windows).
# Remove-Item falha com DLLs assinadas; rmdir /s/q do cmd ignora alguns locks.
function Invoke-RetryRemove {
  param([string]$Path, [int]$MaxRetries = 5, [int]$DelaySeconds = 2)
  if (-not (Test-Path $Path)) { return }
  $attempt = 0
  while ($true) {
    try {
      cmd /c "rmdir /s /q `"$Path`""
      if (-not (Test-Path $Path)) { return }
      Remove-Item $Path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      $attempt++
      if ($attempt -ge $MaxRetries) {
        Write-Host "AVISO: nao foi possivel remover $Path apos $MaxRetries tentativas; renomeando."
        $stale = "$Path.stale.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Rename-Item $Path $stale -ErrorAction SilentlyContinue
        return
      }
      Write-Host ("Retry {0}/{1}: {2}" -f $attempt, $MaxRetries, $_)
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}
function Invoke-RetryMove {
  param([string]$Source, [string]$Dest, [int]$MaxRetries = 5, [int]$DelaySeconds = 2)
  if (-not (Test-Path $Source)) { return }
  $attempt = 0
  while ($true) {
    try {
      Move-Item $Source $Dest -ErrorAction Stop
      return
    } catch {
      $attempt++
      if ($attempt -ge $MaxRetries) {
        Write-Host "AVISO: nao foi possivel mover $Source apos $MaxRetries tentativas; copiando."
        Copy-Item $Source $Dest -Recurse -ErrorAction Stop
        Invoke-RetryRemove $Source
        return
      }
      Write-Host ("Retry {0}/{1}: {2}" -f $attempt, $MaxRetries, $_)
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

New-Item -ItemType Directory -Force -Path $install | Out-Null
Invoke-RetryRemove $previous
Invoke-RetryMove $current $previous

# Ambos os fallbacks acima desistem em silencio. Se current sobreviver, o
# Copy-Item abaixo copia PARA DENTRO dele (current\win-arm64-unpacked\) em vez de
# criar a pasta, e a build instalada fica quebrada sem erro ate o build.json
# falhar. Quem costuma segurar a pasta: o Orca/daemon da build anterior e agentes
# pi com cwd ali dentro.
if (Test-Path $current) {
  throw "current ainda existe apos a rotacao: feche o CoopCode e os agentes (Orca.exe, orca-terminal-daemon.exe, node cli.js) e rode de novo."
}

Copy-Item $unpacked $current -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $current 'opencode') | Out-Null
Copy-Item $opencode (Join-Path $current 'opencode\opencode.exe')

$sha   = (& git -C $repo rev-parse --short HEAD).Trim()
$dirty = [bool](& git -C $repo status --porcelain)
@{
  built_at   = (Get-Date).ToString('s')
  commit     = $sha
  dirty_tree = $dirty
  orca_ver   = (Get-Item (Join-Path $current 'Orca.exe')).VersionInfo.FileVersion
} | ConvertTo-Json | Set-Content (Join-Path $current 'build.json')

# Launcher estavel: o atalho nunca muda de caminho, so o conteudo de current\.
@"
@echo off
set "PATH=%~dp0current\opencode;%PATH%"
start "" "%~dp0current\Orca.exe" %*
"@ | Set-Content (Join-Path $install 'CoopCode.cmd') -Encoding ASCII

Write-Host ""
Write-Host "Instalado em $current  (commit $sha, dirty=$dirty)"
Write-Host "Rodar:    $install\CoopCode.cmd"
Write-Host "Rollback: mova previous\ para current\ ou rode previous\Orca.exe"
