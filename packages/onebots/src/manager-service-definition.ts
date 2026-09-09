import path from "node:path";
import { LAUNCHD_LABEL } from "./service-definition.js";
import {
    buildManagerServiceArgs,
    parseManagerServiceSpec,
    type ManagerServiceSpec,
} from "./manager-service-spec.js";
import { renderWindowsManagerServiceDefinition } from "./service-platform-windows.js";

/** 留给管理服务收回下载器和网关的时间；超时由系统托管者清理剩余进程。 */
export const MANAGER_SERVICE_STOP_TIMEOUT_SECONDS = 90;

function safeText(value: string): string {
    // 配置文件语法不能可靠表达的控制字符与无效 XML 字符明确拒绝，不静默改路径。
    for (const character of value) {
        const code = character.codePointAt(0)!;
        if (
            code < 32 ||
            code === 127 ||
            (code >= 0xd800 && code <= 0xdfff) ||
            code === 0xfffe ||
            code === 0xffff
        )
            throw new Error("管理服务定义含不可表示的字符");
    }
    return value;
}

function systemdArgument(value: string): string {
    return `"${safeText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

function xml(value: string): string {
    return safeText(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/** 调用方仍须以 SERVICE_NAME.service 安装，沿用旧服务身份，不能并行安装第二个单元。 */
export function renderManagerSystemdUnit(input: ManagerServiceSpec): string {
    const spec = parseManagerServiceSpec(input);
    // systemd 对 executable 反转义后再做 string_is_safe 检查；这些字符不能靠引号修复。
    // 普通 argv 不受这项限制，不能误删用户的路径字符。
    if (/["'\\*?\[\]]/.test(spec.nodePath))
        throw new Error(
            "systemd 不支持此 Node 可执行文件路径，请使用不含引号、反斜杠或通配符的安装路径",
        );
    // ':' 禁止 $ 环境变量展开；systemd 不是 shell，百分号仍须单独转义。
    const command = [":" + spec.nodePath, ...buildManagerServiceArgs(spec)]
        .map(systemdArgument)
        .join(" ");
    // WorkingDirectory 不执行 argv 去引号/C 反转义。末尾 /. 防止空白被剥离、反斜杠续行。
    const directory = safeText(spec.workingDirectory).replace(/%/g, "%%") + "/.";
    return `[Unit]
Description=OneBots Control Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${directory}
ExecStart=${command}
Restart=on-failure
RestartSec=5
TimeoutStopSec=${MANAGER_SERVICE_STOP_TIMEOUT_SECONDS}
KillSignal=SIGTERM
KillMode=mixed
SendSIGKILL=yes

[Install]
WantedBy=${spec.scope === "system" ? "multi-user.target" : "default.target"}
`;
}

export function renderManagerLaunchdPlist(
    input: ManagerServiceSpec,
    stdoutPath: string,
    stderrPath: string,
): string {
    const spec = parseManagerServiceSpec(input);
    if (
        ![stdoutPath, stderrPath].every(
            value => typeof value === "string" && path.isAbsolute(value),
        )
    )
        throw new Error("管理服务日志路径必须是绝对路径");
    const args = [spec.nodePath, ...buildManagerServiceArgs(spec)]
        .map(value => `    <string>${xml(value)}</string>`)
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
  <string>${xml(spec.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ExitTimeOut</key>
  <integer>${MANAGER_SERVICE_STOP_TIMEOUT_SECONDS}</integer>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
}

/** 安装、迁移及控制核验共用同一托管定义，防止日志路径等隐式约定漂移。 */
export function renderInstalledManagerService(
    spec: ManagerServiceSpec,
    platform: NodeJS.Platform,
    stateDirectory: string,
): string {
    if (platform === "linux") return renderManagerSystemdUnit(spec);
    if (platform === "darwin")
        return renderManagerLaunchdPlist(
            spec,
            path.join(stateDirectory, "onebots.log"),
            path.join(stateDirectory, "onebots-error.log"),
        );
    if (platform === "win32") return renderWindowsManagerServiceDefinition(spec);
    throw new Error("此系统尚未通过管理服务定义验收");
}
