$ErrorActionPreference = "Stop"

$OneBotsHome = if ($env:ONEBOTS_HOME) { $env:ONEBOTS_HOME } else { Join-Path $HOME ".onebots" }
$RuntimeDir = Join-Path $OneBotsHome "runtime"
$ConfigFile = Join-Path $OneBotsHome "config.yaml"
$NodeDir = Join-Path $OneBotsHome "node"

function Write-Step([string]$Message) {
    Write-Host "[OneBots] $Message"
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
    }
}

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NodeUsable = $false
if ($NodeCommand) {
    $NodeMajor = [int]((& $NodeCommand.Source -p 'Number(process.versions.node.split(".")[0])'))
    $NodeUsable = $NodeMajor -ge 24
}

if (-not $NodeUsable) {
    Write-Step "未找到 Node.js 24，正在安装独立运行环境…"
    $Architecture = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
    $ChecksumsUrl = "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"
    $Checksums = (Invoke-WebRequest -UseBasicParsing $ChecksumsUrl).Content
    $ArchiveLine = ($Checksums -split "`n" | Where-Object { $_ -match "node-v.+-win-$Architecture\.zip$" } | Select-Object -First 1)
    if (-not $ArchiveLine) { throw "Node.js 没有适用于 Windows/$Architecture 的发行包" }
    $Parts = $ArchiveLine.Trim() -split "\s+"
    $ExpectedHash = $Parts[0]
    $Archive = $Parts[1]
    $Temporary = Join-Path ([System.IO.Path]::GetTempPath()) $Archive
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v24.x/$Archive" -OutFile $Temporary
    $ActualHash = (Get-FileHash -Algorithm SHA256 $Temporary).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash.ToLowerInvariant()) { throw "Node.js 安装包校验失败" }
    $ExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "onebots-node-$PID"
    Remove-Item $ExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $Temporary $ExtractRoot -Force
    Remove-Item $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item $NodeDir -ItemType Directory -Force | Out-Null
    $Extracted = Get-ChildItem $ExtractRoot -Directory | Select-Object -First 1
    Copy-Item (Join-Path $Extracted.FullName "*") $NodeDir -Recurse -Force
    Remove-Item $ExtractRoot -Recurse -Force
    Remove-Item $Temporary -Force
    $NodePath = Join-Path $NodeDir "node.exe"
} else {
    $NodePath = $NodeCommand.Source
}

$NodeBin = Split-Path $NodePath
$env:PATH = "$NodeBin;$env:PATH"
$NpmPath = Join-Path $NodeBin "npm.cmd"
if (-not (Test-Path $NpmPath)) { $NpmPath = (Get-Command npm.cmd).Source }

New-Item $RuntimeDir -ItemType Directory -Force | Out-Null
$Manifest = Join-Path $RuntimeDir "package.json"
$ConfigExists = Test-Path $ConfigFile
if (-not (Test-Path $Manifest)) {
    '{"name":"onebots-managed-runtime","private":true,"version":"1.0.0"}' | Set-Content $Manifest -Encoding utf8
}

Write-Step "正在安装 OneBots、Web 管理端和默认 OneBot v11 协议…"
Push-Location $RuntimeDir
try {
    Invoke-Checked -FilePath $NpmPath -Arguments @("install", "--omit=dev", "onebots@latest", "@onebots/web@latest", "@onebots/protocol-onebot-v11@latest")
    $OneBots = Join-Path $RuntimeDir "node_modules/.bin/onebots.cmd"
    $env:ONEBOTS_EXTENSION_ROOT = $RuntimeDir
    if (-not $ConfigExists) {
        Invoke-Checked -FilePath $OneBots -Arguments @("setup", "-c", $ConfigFile, "-p", "onebot-v11")
    } else {
        Write-Step "检测到已有配置，保留账号、凭据和插件选择：$ConfigFile"
    }
    Invoke-Checked -FilePath $OneBots -Arguments @("install", "-c", $ConfigFile)
    & $OneBots restart
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked -FilePath $OneBots -Arguments @("start")
    }
} finally {
    Pop-Location
}

$Port = 6727
$Token = ""
foreach ($Line in Get-Content $ConfigFile) {
    if ($Line -match '^port:\s*(\d+)') { $Port = $Matches[1] }
    if ($Line -match '^access_token:\s*["'']?([^"'']+)["'']?') { $Token = $Matches[1].Trim() }
}

Write-Step "安装完成。"
Write-Step "管理地址：http://127.0.0.1:$Port"
if ($Token) {
    Write-Step "首次登录鉴权码：$Token"
    Write-Step "请登录后立即保存到密码管理器；该鉴权码不会再次显示。"
}
Write-Step "以后可直接在 Web 的“功能扩展”页面安装 Slack、Telegram 等平台。"
