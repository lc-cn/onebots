/**
 * 网关 daemon：pid 文件读写与后台进程管理
 */
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

const PID_FILE = "onebots-gateway.pid";

/**
 * 根据配置路径确定 pid 文件所在目录（与网关进程一致）
 */
export function getPidDir(configPath: string): string {
    const resolved = path.resolve(process.cwd(), configPath);
    return path.dirname(resolved);
}

export function getPidPath(configPath: string): string {
    return path.join(getPidDir(configPath), PID_FILE);
}

export function writePid(configPath: string, pid: number): void {
    const file = getPidPath(configPath);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, String(pid), "utf8");
}

export function readPid(configPath: string): number | null {
    const file = getPidPath(configPath);
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, "utf8").trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
}

export function removePidFile(configPath: string): void {
    const file = getPidPath(configPath);
    if (fs.existsSync(file)) {
        try {
            fs.unlinkSync(file);
        } catch {
            // 忽略
        }
    }
}

/**
 * 检查 pid 是否对应存活进程
 */
export function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * 向网关进程发送 SIGTERM
 */
export function stopProcess(pid: number): boolean {
    if (!isProcessRunning(pid)) return false;
    try {
        process.kill(pid, "SIGTERM");
        return true;
    } catch {
        return false;
    }
}

/**
 * 在后台启动网关：spawn 子进程执行 onebots gateway start -c <configPath> [-r ...] [-p ...]
 * 返回子进程 pid；父进程写 pid 文件后退出。
 */
export function daemonStart(options: {
    configPath: string;
    adapters: string[];
    protocols: string[];
    /** Node 可执行路径 */
    nodePath: string;
    /** onebots CLI 入口路径（如 lib/bin.js） */
    binPath: string;
}): number {
    const args = [
        options.binPath,
        "gateway",
        "start",
        "-c",
        options.configPath,
        ...options.adapters.flatMap((r) => ["-r", r]),
        ...options.protocols.flatMap((p) => ["-p", p]),
    ];
    const child = spawn(options.nodePath, args, {
        cwd: getPidDir(options.configPath),
        stdio: "ignore",
        detached: true,
        env: process.env,
    });
    child.unref();
    return child.pid!;
}
