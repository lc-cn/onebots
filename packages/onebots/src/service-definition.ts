/** 守护服务定义与跨平台命令行渲染。 */

export const SERVICE_NAME = "onebots-gateway";
export const LAUNCHD_LABEL = `com.onebots.${SERVICE_NAME}`;

export type ServiceScope = "user" | "system";
export type ServiceRuntimeCommand = "run" | "preflight";

export interface ServiceSpec {
    scope: ServiceScope;
    configPath: string;
    adapters: string[];
    protocols: string[];
    applications?: string[];
    nodePath: string;
    binPath: string;
    workingDirectory: string;
}

export interface ServiceStatus {
    installed: boolean;
    running: boolean;
    scope: ServiceScope;
    detail: string;
    /** 存在时表示 running 只是保守占位，进程管理器没有给出权威状态。 */
    error?: string;
}

export interface ServiceCommandOptions {
    follow?: boolean;
    lines?: number;
}

export function buildServiceArgs(
    spec: ServiceSpec,
    command: ServiceRuntimeCommand = "run",
): string[] {
    return [
        spec.binPath,
        "--service-runtime",
        command,
        "-c",
        spec.configPath,
        ...spec.adapters.flatMap(adapter => ["-r", adapter]),
        ...spec.protocols.flatMap(protocol => ["-p", protocol]),
        ...(spec.applications ?? []).flatMap(application => ["-t", application]),
    ];
}

function systemdQuote(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export function renderSystemdUnit(spec: ServiceSpec): string {
    const command = [spec.nodePath, ...buildServiceArgs(spec)].map(systemdQuote).join(" ");
    return `[Unit]
Description=OneBots Bridge Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(spec.workingDirectory)}
ExecStart=${command}
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM

[Install]
WantedBy=${spec.scope === "system" ? "multi-user.target" : "default.target"}
`;
}

export function renderLaunchdPlist(
    spec: ServiceSpec,
    stdoutPath: string,
    stderrPath: string,
): string {
    const args = [spec.nodePath, ...buildServiceArgs(spec)]
        .map(value => `    <string>${xmlEscape(value)}</string>`)
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(spec.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ExitTimeOut</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function windowsQuote(value: string): string {
    if (!/[\s"]/u.test(value)) return value;
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

export function renderWindowsCommand(spec: ServiceSpec): string {
    return [spec.nodePath, ...buildServiceArgs(spec)].map(windowsQuote).join(" ");
}

export function renderWindowsScriptOptions(spec: ServiceSpec): string {
    return buildServiceArgs(spec).slice(1).map(windowsQuote).join(" ");
}

/** 生成带 5 秒失败重启策略的 Windows 用户计划任务。 */
export function renderWindowsTaskXml(runnerPath: string): string {
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT5S</Interval><Count>999</Count></RestartOnFailure>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>${xmlEscape(`/d /s /c "${runnerPath}"`)}</Arguments></Exec></Actions>
</Task>
`;
}
