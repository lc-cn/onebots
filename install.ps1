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

function Wait-OneBotsReady([string]$OneBotsCommand) {
    $LastStatus = @()
    for ($Attempt = 1; $Attempt -le 15; $Attempt++) {
        $LastStatus = @(& $OneBotsCommand status 2>&1)
        if ($LASTEXITCODE -eq 0) {
            if ($LastStatus.Count -gt 0) { Write-Host ($LastStatus -join [Environment]::NewLine) }
            return
        }
        if ($Attempt -lt 15) { Start-Sleep -Seconds 1 }
    }
    $Evidence = if ($LastStatus.Count -gt 0) { $LastStatus -join [Environment]::NewLine } else { "服务尚未响应" }
    throw "服务启动后未通过在线验证；请运行 onebots status 并检查服务日志。最后状态：$Evidence"
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

$OneBotsManifest = Join-Path $RuntimeDir "node_modules/onebots/package.json"
$PreviousOneBotsVersion = ""
$RollbackOneBots = $false
if ($ConfigExists -and (Test-Path $OneBotsManifest)) {
    $PreviousOneBotsVersion = (Get-Content $OneBotsManifest -Raw | ConvertFrom-Json).version
    if (-not $PreviousOneBotsVersion -or $PreviousOneBotsVersion -notmatch '^[0-9A-Za-z][0-9A-Za-z.+_-]*$') {
        throw "现有 OneBots 版本无效，无法建立安全升级回滚点"
    }
    $RollbackOneBots = $true
}

Write-Step "正在安装 OneBots 与匹配的 Web 管理端…"
Push-Location $RuntimeDir
try {
    Invoke-Checked -FilePath $NpmPath -Arguments @("install", "--omit=dev", "onebots@latest")
    $OneBots = Join-Path $RuntimeDir "node_modules/.bin/onebots.cmd"
    if (-not (Test-Path $OneBots)) { throw "OneBots 命令安装不完整" }

    $CatalogFile = Join-Path $RuntimeDir "node_modules/onebots/lib/extension-capability-catalog.json"
    $WebEntry = Join-Path $RuntimeDir "node_modules/@onebots/web/dist/index.html"
    $NestedWebEntry = Join-Path $RuntimeDir "node_modules/onebots/node_modules/@onebots/web/dist/index.html"
    if (-not (Test-Path $CatalogFile)) { throw "OneBots 扩展版本目录缺失，无法选择匹配的默认协议" }
    if (-not (Test-Path $WebEntry) -and -not (Test-Path $NestedWebEntry)) {
        throw "与 OneBots 匹配的 Web 管理端产物缺失"
    }
    if (-not $ConfigExists) {
        $Catalog = Get-Content $CatalogFile -Raw | ConvertFrom-Json
        $ProtocolVersion = $Catalog.packages.'@onebots/protocol-onebot-v11'.version
        if (-not $ProtocolVersion -or $ProtocolVersion -notmatch '^[0-9A-Za-z][0-9A-Za-z.+_-]*$') {
            throw "OneBots 扩展目录中的 OneBot v11 版本无效"
        }
        Write-Step "正在安装 OneBots 验证的 OneBot v11 协议版本 $($ProtocolVersion)…"
        Invoke-Checked -FilePath $NpmPath -Arguments @("install", "--omit=dev", "@onebots/protocol-onebot-v11@$ProtocolVersion")

        $ProtocolManifest = Join-Path $RuntimeDir "node_modules/@onebots/protocol-onebot-v11/package.json"
        if (-not (Test-Path $ProtocolManifest)) { throw "默认 OneBot v11 协议安装不完整" }
        $InstalledProtocolVersion = (Get-Content $ProtocolManifest -Raw | ConvertFrom-Json).version
        if ($InstalledProtocolVersion -ne $ProtocolVersion) {
            throw "默认 OneBot v11 协议版本校验失败：期望 $($ProtocolVersion)，实际 $InstalledProtocolVersion"
        }
    }

    $env:ONEBOTS_EXTENSION_ROOT = $RuntimeDir
    if (-not $ConfigExists) {
        Invoke-Checked -FilePath $OneBots -Arguments @("setup", "-c", $ConfigFile, "-p", "onebot-v11")
    } else {
        Write-Step "检测到已有配置，保留账号、凭据和插件选择：$ConfigFile"
    }
    Write-Step "正在同步配置中已选扩展的验证版本…"
    Invoke-Checked -FilePath $OneBots -Arguments @(
        "update", "-c", $ConfigFile, "--yes", "--packages-only"
    )
    $RollbackOneBots = $false
    Invoke-Checked -FilePath $OneBots -Arguments @("install", "-c", $ConfigFile)
    & $OneBots restart
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked -FilePath $OneBots -Arguments @("start")
    }
    Wait-OneBotsReady -OneBotsCommand $OneBots
    $StatusJson = @(& $OneBots status --json)
    if ($LASTEXITCODE -ne 0) {
        throw "服务虽已通过等待门禁，但无法取得最终状态证据"
    }
    $StatusReport = ($StatusJson -join [Environment]::NewLine) | ConvertFrom-Json
    $ManagementUrl = [string]$StatusReport.target.webUrl
    if (-not $StatusReport.ok -or -not $ManagementUrl) {
        throw "最终状态证据缺少已验证的 Web 管理地址"
    }
} catch {
    $InstallError = $_
    if ($RollbackOneBots -and $PreviousOneBotsVersion) {
        Write-Step "安装未通过依赖事务，正在恢复 OneBots $PreviousOneBotsVersion…"
        try {
            Invoke-Checked -FilePath $NpmPath -Arguments @("install", "--omit=dev", "onebots@$PreviousOneBotsVersion")
            $RestoredVersion = (Get-Content $OneBotsManifest -Raw | ConvertFrom-Json).version
            if ($RestoredVersion -ne $PreviousOneBotsVersion) {
                throw "期望 $PreviousOneBotsVersion，实际 $RestoredVersion"
            }
            $env:ONEBOTS_EXTENSION_ROOT = $RuntimeDir
            Invoke-Checked -FilePath $OneBots -Arguments @(
                "--service-runtime", "preflight", "-c", $ConfigFile
            )
            Write-Step "已恢复升级前的 OneBots $PreviousOneBotsVersion，并通过隔离预检。"
        } catch {
            throw "安装失败：$($InstallError.Exception.Message)；OneBots 恢复失败：$($_.Exception.Message)"
        }
    }
    throw $InstallError
} finally {
    Pop-Location
}

$Token = ""
foreach ($Line in Get-Content $ConfigFile) {
    if (-not $ConfigExists) {
        if ($Line -match '^access_token:\s*["'']?([^"'']+)["'']?') { $Token = $Matches[1].Trim() }
    }
}

Write-Step "安装完成。"
Write-Step "管理地址：$ManagementUrl"
if (-not $ConfigExists -and $Token) {
    Write-Step "首次登录鉴权码：$Token"
    Write-Step "请登录后立即保存到密码管理器；后续重复安装不会提取或显示已有鉴权码。"
} elseif ($ConfigExists) {
    Write-Step "已保留现有管理凭据且未显示；如需登录，请从配置文件读取：$ConfigFile"
} else {
    Write-Step "请使用配置文件中的管理凭据登录：$ConfigFile"
}
Write-Step "以后可直接在 Web 的“功能扩展”页面安装 Slack、Telegram 等平台。"
