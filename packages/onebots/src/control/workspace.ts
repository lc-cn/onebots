import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { acquireExclusiveFileLock } from "../exclusive-file-lock.js";
import yaml from "js-yaml";
import { getConfiguredPluginSelection } from "../runtime-plugin-selection.js";
import packageMetadata from "../../package.json" with { type: "json" };

export function controlDirectory(root: string): string {
    return path.join(path.resolve(root), ".control");
}

export function controlSocket(root: string): string {
    if (process.platform === "win32")
        throw new Error("Windows 本地控制传输尚待 ACL 验收，当前不开放命名管道");
    const socket = path.join(controlDirectory(root), "control.sock");
    // sockaddr_un 包含终止字节；使用各 POSIX 平台可接受的保守上限。
    if (Buffer.byteLength(socket) <= 103) return socket;
    // 隔离候选 worker 固定在自己的工作区内执行；相对地址仍落在同一所有权目录。
    if (path.resolve(root) === process.cwd()) return path.join(".control", "control.sock");
    throw new Error("本地控制套接字路径过长，请在工作区目录内执行或使用较短的工作区路径");
}

/**
 * 只支持提供可靠 SQLite 文件锁的本地卷，不支持 NFS/多主机共享工作区。
 * 专用数据库长期保持写事务，崩溃由 OS 释放锁；不得删除或替换数据库文件。
 */
export function acquireControlWorkspace(root: string): () => void {
    fs.mkdirSync(path.resolve(root), { recursive: true, mode: 0o700 });
    const directory = controlDirectory(fs.realpathSync(root));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("管理服务目录不能是符号链接");
    fs.chmodSync(directory, 0o700);
    return acquireExclusiveFileLock(path.join(directory, "manager-lock.sqlite"), {
        busyMessage: "此工作区已有管理服务，禁止重复启动",
        invalidMessage: "管理服务锁数据库必须是独立常规文件",
        unavailableMessage: "管理服务锁数据库无法使用，请检查本地卷与文件状态",
        repairPermissions: true,
    });
}

/** 冷恢复只探测旧 leader 与 POSIX 进程组，绝不向历史 PID 发送终止信号。 */
export function gatewayProcessExists(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff || process.platform === "win32")
        throw new Error("无法确认历史网关进程组状态");
    let exists = false;
    for (const target of [pid, -pid]) {
        try {
            process.kill(target, 0);
            exists = true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                throw new Error("无法确认历史网关进程组状态");
        }
    }
    return exists;
}

/** 网关只接收配置快照，管理认证从不进入该文件。 */
export function prepareGatewayWorkspace(root: string, runtimeRoot = process.cwd()) {
    const configPath = path.join(root, "config.yaml");
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(
            configPath,
            yaml.dump({ plugins: { adapters: [], protocols: [], applications: [] } }),
            { flag: "wx", mode: 0o600 },
        );
    }
    let config: unknown;
    try {
        config = yaml.load(fs.readFileSync(configPath, "utf8"));
    } catch {
        throw new Error("网关配置无法读取或解析，请检查工作区配置");
    }
    if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error("网关配置必须是 YAML 对象，管理服务仍可用于修复");
    const runtime = { ...config } as Record<string, unknown>;
    delete runtime.username;
    delete runtime.password;
    delete runtime.access_token;
    const content = yaml.dump(runtime);
    const configVersion = createHash("sha256").update(content).digest("hex");
    const snapshots = path.join(controlDirectory(root), "configurations");
    fs.mkdirSync(snapshots, { recursive: true, mode: 0o700 });
    const snapshot = path.join(snapshots, `${configVersion}.yaml`);
    if (!fs.existsSync(snapshot)) fs.writeFileSync(snapshot, content, { flag: "wx", mode: 0o600 });
    const selection = getConfiguredPluginSelection(runtime, true) ?? {
        adapters: [],
        protocols: [],
        applications: [],
    };
    return {
        configPath: snapshot,
        workspacePath: path.resolve(root),
        selection: { ...selection, applications: selection.applications ?? [] },
        configVersion,
        dependencyVersion: `bundled:${packageMetadata.version}`,
        entrypoint: path.resolve(import.meta.dirname, "../gateway/entry.js"),
        runtimeRoot: path.resolve(runtimeRoot),
    };
}
