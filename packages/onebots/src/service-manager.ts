/**
 * 网关系统服务：systemd / launchd / Windows
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const SERVICE_NAME = "onebots-gateway";

function getConfigDir(configPath: string): string {
    return path.dirname(path.resolve(process.cwd(), configPath));
}

export async function serviceInstall(configPath: string): Promise<void> {
    const configDir = getConfigDir(configPath);
    const resolvedConfig = path.resolve(process.cwd(), configPath);
    const nodePath = process.execPath;
    const binPath = process.argv[1];
    const startCmd = `"${nodePath}" "${binPath}" gateway start -c "${resolvedConfig}"`;

    if (process.platform === "darwin") {
        const plistPath = path.join(process.env.HOME!, "Library", "LaunchAgents", `com.onebots.${SERVICE_NAME}.plist`);
        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.onebots.${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${binPath}</string>
    <string>gateway</string>
    <string>start</string>
    <string>-c</string>
    <string>${resolvedConfig}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${configDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
</dict>
</plist>
`;
        const dir = path.dirname(plistPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(plistPath, plist, "utf8");
        console.log("已安装 launchd 服务:", plistPath);
        console.log("启用: launchctl load " + plistPath);
        return;
    }

    if (process.platform === "linux") {
        const unitDir = path.join(process.env.HOME!, ".config", "systemd", "user");
        if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });
        const unitPath = path.join(unitDir, `${SERVICE_NAME}.service`);
        const unit = `[Unit]
Description=OneBots Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=${configDir}
ExecStart=${nodePath} ${binPath} gateway start -c ${resolvedConfig}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
        fs.writeFileSync(unitPath, unit, "utf8");
        console.log("已安装 systemd 用户服务:", unitPath);
        try {
            execSync("systemctl --user daemon-reload", { stdio: "inherit" });
            console.log("启用: systemctl --user enable --now " + SERVICE_NAME);
        } catch {
            console.log("请执行: systemctl --user daemon-reload && systemctl --user enable --now " + SERVICE_NAME);
        }
        return;
    }

    if (process.platform === "win32") {
        console.log("Windows 请使用 onebots gateway daemon 配合「任务计划程序」实现开机自启：");
        console.log("  1. 打开 任务计划程序");
        console.log("  2. 创建基本任务，触发器选「计算机启动时」");
        console.log("  3. 操作：启动程序");
        console.log("     程序/脚本: " + nodePath);
        console.log("     添加参数: " + [binPath, "gateway", "daemon", "-c", resolvedConfig].map((a) => `"${a}"`).join(" "));
        console.log("     起始于: " + configDir);
        process.exit(0);
        return;
    }

    console.error("当前系统暂不支持 service install");
    process.exit(1);
}

export async function serviceUninstall(): Promise<void> {
    if (process.platform === "darwin") {
        const plistPath = path.join(process.env.HOME!, "Library", "LaunchAgents", `com.onebots.${SERVICE_NAME}.plist`);
        try {
            execSync(`launchctl unload "${plistPath}"`, { stdio: "inherit" });
        } catch {
            // ignore
        }
        if (fs.existsSync(plistPath)) {
            fs.unlinkSync(plistPath);
            console.log("已卸载 launchd 服务");
        }
        return;
    }

    if (process.platform === "linux") {
        const unitPath = path.join(process.env.HOME!, ".config", "systemd", "user", `${SERVICE_NAME}.service`);
        try {
            execSync("systemctl --user disable " + SERVICE_NAME, { stdio: "inherit" });
        } catch {
            // ignore
        }
        if (fs.existsSync(unitPath)) {
            fs.unlinkSync(unitPath);
            console.log("已卸载 systemd 服务");
        }
        try {
            execSync("systemctl --user daemon-reload", { stdio: "inherit" });
        } catch {
            // ignore
        }
        return;
    }

    if (process.platform === "win32") {
        console.log("Windows 请在「任务计划程序」中手动删除对应任务");
        process.exit(0);
        return;
    }

    console.error("当前系统暂不支持 service uninstall");
    process.exit(1);
}

export async function serviceStatus(): Promise<void> {
    if (process.platform === "darwin") {
        try {
            const out = execSync("launchctl list | grep onebots", { encoding: "utf8" });
            console.log(out || "未找到 onebots 服务");
        } catch {
            console.log("未找到 onebots 服务或未加载");
        }
        return;
    }

    if (process.platform === "linux") {
        try {
            execSync("systemctl --user status " + SERVICE_NAME, { stdio: "inherit" });
        } catch (e: unknown) {
            const code = (e as { status?: number })?.status;
            if (code !== 0) console.log("服务未运行或未安装");
        }
        return;
    }

    if (process.platform === "win32") {
        console.log("Windows 请在「任务计划程序」中查看任务状态");
        process.exit(0);
        return;
    }

    console.error("当前系统暂不支持 service status");
    process.exit(1);
}
