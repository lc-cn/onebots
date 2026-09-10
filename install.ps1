$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host "[OneBots] $Message"
}

function Fail-Install([string]$Message) {
    throw "安装未完成：$Message；候选目录保留，请先核查，不会自动回滚或重新启动。"
}

function Test-ReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $Item = Get-Item -LiteralPath $Path -Force
    return ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

function Test-RegularArtifact([string]$Path) {
    return (Test-Path -LiteralPath $Path -PathType Leaf) -and
        -not (Test-ReparsePoint $Path) -and
        (Get-Item -LiteralPath $Path).Length -gt 0
}

function Test-Administrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        Fail-Install "命令执行失败（退出码 $LASTEXITCODE）：$FilePath"
    }
}

function Invoke-IsolatedNpm([string]$NpmPath, [string[]]$Arguments, [string]$BootstrapRoot) {
    $Saved = @{}
    $Names = @(Get-ChildItem Env: | Where-Object {
        $_.Name -match '(?i)(token|auth)' -or
        $_.Name -match '(?i)^npm_config_' -or
        $_.Name -eq 'NODE_OPTIONS'
    } | ForEach-Object { $_.Name })
    foreach ($Name in $Names) {
        $Saved[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
        [Environment]::SetEnvironmentVariable($Name, $null, "Process")
    }
    foreach ($Name in @("HOME", "USERPROFILE", "NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG", "NPM_CONFIG_CACHE")) {
        if (-not $Saved.ContainsKey($Name)) {
            $Saved[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
        }
    }
    try {
        $BootstrapHome = Join-Path $BootstrapRoot "home"
        $env:HOME = $BootstrapHome
        $env:USERPROFILE = $BootstrapHome
        $env:NPM_CONFIG_USERCONFIG = Join-Path $BootstrapRoot "user.npmrc"
        $env:NPM_CONFIG_GLOBALCONFIG = Join-Path $BootstrapRoot "global.npmrc"
        $env:NPM_CONFIG_CACHE = Join-Path $BootstrapRoot "cache"
        Invoke-Checked $NpmPath $Arguments
    } finally {
        foreach ($Entry in $Saved.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($Entry.Key, $Entry.Value, "Process")
        }
    }
}

$OneBotsHome = if ($env:ONEBOTS_HOME) { $env:ONEBOTS_HOME } else { Join-Path $HOME ".onebots" }
if (-not [System.IO.Path]::IsPathRooted($OneBotsHome)) {
    Write-Error "[OneBots] ONEBOTS_HOME 必须是绝对路径"
    exit 1
}
$OneBotsHome = [System.IO.Path]::GetFullPath($OneBotsHome)
$RuntimeDir = Join-Path $OneBotsHome "runtime"
$NodeDir = Join-Path $OneBotsHome "node"
$BootstrapRoot = Join-Path $OneBotsHome ".bootstrap"
$Marker = Join-Path $OneBotsHome ".manager-installed"
$Lock = Join-Path $OneBotsHome ".install-lock"
$WorkDir = $null
$Locked = $false
$ExitCode = 0

try {
    if (-not (Test-Administrator)) {
        Fail-Install "Windows 管理服务必须在管理员 PowerShell 中安装"
    }
    if (Test-ReparsePoint $OneBotsHome) { Fail-Install "安装目录不能是重解析点" }
    if ((Test-Path -LiteralPath $Marker -PathType Leaf) -and -not (Test-ReparsePoint $Marker)) {
        if ((Get-Content -LiteralPath $Marker -Raw).Trim() -eq "onebots-manager-install-v1") {
            Write-Step "此目录已有安装成功的管理程序。未修改依赖或重启服务，请使用现有 CLI 管理。"
            exit 0
        }
    }
    if (Test-Path -LiteralPath $OneBotsHome) {
        if (-not (Test-Path -LiteralPath $OneBotsHome -PathType Container)) {
            Fail-Install "安装路径不是目录"
        }
        if (@(Get-ChildItem -LiteralPath $OneBotsHome -Force).Count -ne 0) {
            Fail-Install "目录已有运行数据或未完成候选，原文件保持不变；旧服务请使用 onebots migrate"
        }
    } else {
        New-Item -ItemType Directory -Path $OneBotsHome | Out-Null
    }
    try {
        New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null
        $Locked = $true
    } catch {
        Fail-Install "另一安装进程已占用此目录"
    }

    $Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    $NodeArch = if ($Architecture -eq "X64") { "x64" } elseif ($Architecture -eq "Arm64") { "arm64" } else { Fail-Install "不支持此处理器架构" }
    $NodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $NodePath = $null
    if ($NodeCommand) {
        $NodeMajorText = @(& $NodeCommand.Source -p 'Number(process.versions.node.split(".")[0])' 2>$null)
        if ($LASTEXITCODE -eq 0 -and ($NodeMajorText -join "").Trim() -match '^\d+$' -and [int](($NodeMajorText -join "").Trim()) -ge 24) {
            $NodePath = $NodeCommand.Source
        }
    }

    if (-not $NodePath) {
        if (Test-Path -LiteralPath $NodeDir) { Fail-Install "已有 Node.js 目录，拒绝覆盖" }
        $WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("onebots-install-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $WorkDir | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Write-Step "正在下载并校验独立 Node.js 24 运行环境…"
        $Checksums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt" -TimeoutSec 120).Content
        $Pattern = "^([0-9a-fA-F]{64})\s+(node-v24\.[0-9]+\.[0-9]+-win-$NodeArch\.zip)$"
        $ExpectedHash = $null
        $Archive = $null
        foreach ($Line in ($Checksums -split "`n")) {
            if ($Line.Trim() -match $Pattern) {
                $ExpectedHash = $Matches[1].ToLowerInvariant()
                $Archive = $Matches[2]
                break
            }
        }
        if (-not $ExpectedHash -or -not $Archive) { Fail-Install "没有匹配的 Node.js 24 发行包" }
        $ArchivePath = Join-Path $WorkDir $Archive
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/latest-v24.x/$Archive" -OutFile $ArchivePath -TimeoutSec 300
        $ActualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ActualHash -ne $ExpectedHash) { Fail-Install "Node.js 安装包校验失败" }
        $ExtractRoot = Join-Path $WorkDir "node"
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot
        $Extracted = @(Get-ChildItem -LiteralPath $ExtractRoot -Directory)
        if ($Extracted.Count -ne 1) { Fail-Install "Node.js 安装包目录结构无效" }
        New-Item -ItemType Directory -Path $NodeDir | Out-Null
        Copy-Item -Path (Join-Path $Extracted[0].FullName "*") -Destination $NodeDir -Recurse
        $NodePath = Join-Path $NodeDir "node.exe"
    }

    $NodeBin = Split-Path -Parent $NodePath
    $NpmPath = Join-Path $NodeBin "npm.cmd"
    if (-not (Test-Path -LiteralPath $NpmPath -PathType Leaf)) { Fail-Install "选定 Node.js 环境缺少 npm" }

    New-Item -ItemType Directory -Path $RuntimeDir | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $BootstrapRoot "home") -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $RuntimeDir "package.json") -Encoding ASCII -Value '{"name":"onebots-manager-runtime","private":true,"version":"1.0.0"}'
    Set-Content -LiteralPath (Join-Path $BootstrapRoot "user.npmrc") -Encoding ASCII -Value ""
    Set-Content -LiteralPath (Join-Path $BootstrapRoot "global.npmrc") -Encoding ASCII -Value ""
    Write-Step "正在安装公开发布的 OneBots 管理程序…"
    Push-Location $RuntimeDir
    try {
        Invoke-IsolatedNpm $NpmPath @(
            "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact",
            "--registry=https://registry.npmjs.org", "onebots@latest"
        ) $BootstrapRoot
    } finally {
        Pop-Location
    }

    $PackageDir = Join-Path $RuntimeDir "node_modules/onebots"
    $OneBotsBin = Join-Path $PackageDir "lib/bin.js"
    foreach ($Entry in @(
        $OneBotsBin,
        (Join-Path $PackageDir "lib/control/host.js"),
        (Join-Path $PackageDir "lib/gateway/entry.js"),
        (Join-Path $PackageDir "lib/native/win32-$NodeArch/onebots-windows-host.exe")
    )) {
        if (-not (Test-RegularArtifact $Entry)) {
            Fail-Install "发布包缺少新管理架构工件，未执行旧 CLI"
        }
    }
    $WebEntry = Join-Path $RuntimeDir "node_modules/@onebots/web/dist/index.html"
    $NestedWebEntry = Join-Path $PackageDir "node_modules/@onebots/web/dist/index.html"
    if (-not (Test-RegularArtifact $WebEntry) -and -not (Test-RegularArtifact $NestedWebEntry)) {
        Fail-Install "发布包缺少 Web 管理端工件"
    }

    $DownloadEnvironment = @(Get-ChildItem Env: | Where-Object {
        $_.Name -match '(?i)(token|auth)' -or
        $_.Name -match '(?i)^npm_config_' -or
        $_.Name -eq 'NODE_OPTIONS'
    } | ForEach-Object { $_.Name })
    foreach ($Name in $DownloadEnvironment) {
        [Environment]::SetEnvironmentVariable($Name, $null, "Process")
    }
    Write-Step "正在登记并启动用户级管理服务…"
    Push-Location $RuntimeDir
    try {
        Invoke-Checked $NodePath @($OneBotsBin, "install", "--system", "--data-dir", $OneBotsHome)
        Invoke-Checked $NodePath @($OneBotsBin, "start", "--system")
        $StatusOutput = @(& $NodePath $OneBotsBin status --system --json 2>&1)
        if ($LASTEXITCODE -ne 0) { Fail-Install "系统服务状态检查失败" }
    } finally {
        Pop-Location
    }
    try {
        $Status = ($StatusOutput -join [Environment]::NewLine) | ConvertFrom-Json
        if ($Status.schemaVersion -ne 1 -or $Status.installation -ne "control" -or
            $Status.manager.state -ne "running" -or $Status.manager.ipc -ne "available" -or
            $Status.serviceRecoveryRequired -ne $false -or $null -ne $Status.diagnostic -or
            $Status.gateway.recoveryRequired -ne $false) {
            Fail-Install "管理服务尚未确认运行，不能报告成功"
        }
    } catch {
        if ($_.Exception.Message -like "安装未完成：*") { throw }
        Fail-Install "管理服务状态证据无效，不能报告成功"
    }

    $MarkerTemporary = "$Marker.tmp"
    Set-Content -LiteralPath $MarkerTemporary -Encoding ASCII -Value "onebots-manager-install-v1"
    Move-Item -LiteralPath $MarkerTemporary -Destination $Marker
    Write-Step "管理服务已安装并确认运行。未安装平台或输出协议，未自动启动业务账号。"
    Write-Step "使用设备码配对：`"$NodePath`" `"$OneBotsBin`" auth bootstrap --data-dir `"$OneBotsHome`""
    Write-Step "配置和管理：`"$NodePath`" `"$OneBotsBin`" ui --system --data-dir `"$OneBotsHome`""
} catch {
    [Console]::Error.WriteLine("[OneBots] $($_.Exception.Message)")
    $ExitCode = 1
} finally {
    if ($WorkDir -and (Test-Path -LiteralPath $WorkDir)) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($Locked -and (Test-Path -LiteralPath $Lock -PathType Container)) {
        Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue
    }
}

exit $ExitCode
