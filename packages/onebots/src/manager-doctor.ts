import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ControlDiagnostics } from "@onebots/core/control";
import { resolveManagerDoctorTarget } from "./manager-doctor-target.js";
import { inspectManagerServiceStatus } from "./manager-service-status.js";
import { inspectManagerDiagnostics } from "./manager-doctor-client.js";
import { probeManagerWeb } from "./manager-doctor-probes.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";

export interface ManagerDoctorCheck {
    id: string;
    status: "pass" | "warn" | "fail";
    message: string;
}
export interface ManagerDoctorOptions {
    dataDir?: string;
    system?: boolean;
    strict?: boolean;
    fix?: boolean;
}
export interface ManagerDoctorReport {
    schemaVersion: 1;
    checks: ManagerDoctorCheck[];
    exitCode: 0 | 1;
}
export interface ManagerDoctorDependencies {
    inspectService?: typeof inspectManagerServiceStatus;
    inspectDiagnostics?: (workspace: string) => Promise<ControlDiagnostics>;
    probe?: (state: ControlDiagnostics) => Promise<ManagerDoctorCheck[]>;
}
export async function runManagerDoctor(
    options: ManagerDoctorOptions,
    host: ServiceHost = createDefaultServiceHost(),
    dependencies: ManagerDoctorDependencies = {},
): Promise<ManagerDoctorReport> {
    const checks: ManagerDoctorCheck[] = [];
    const add = (id: string, status: ManagerDoctorCheck["status"], message: string) =>
        checks.push({ id, status, message });
    const result = (): ManagerDoctorReport => ({
        schemaVersion: 1,
        checks,
        exitCode: checks.some(
            check => check.status === "fail" || (options.strict && check.status === "warn"),
        )
            ? 1
            : 0,
    });
    if (options.fix) {
        add(
            "automatic-repair",
            "fail",
            "诊断不再自动改写权限或重装服务。请通过配置修复、migrate 或 recover 处理对应问题。",
        );
        return result();
    }
    add(
        "node",
        Number(process.versions.node.split(".")[0]) >= 24 ? "pass" : "fail",
        "OneBots 需要 Node.js 24 或更新版本。",
    );
    const target = resolveManagerDoctorTarget(options, host);
    if (target.kind === "unavailable") {
        add("target", "fail", target.message);
        return result();
    }
    add(
        "target",
        "pass",
        target.kind === "foreground"
            ? "诊断现有前台工作区，不要求安装系统服务。"
            : "已确认管理服务契约。",
    );
    try {
        const directory = path.join(target.workspace, ".control");
        const stat = fs.lstatSync(directory);
        const safe =
            stat.isDirectory() &&
            !stat.isSymbolicLink() &&
            stat.uid === process.getuid?.() &&
            (stat.mode & 0o7777) === 0o700;
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        add(
            "control-directory",
            safe ? "pass" : "fail",
            safe ? "管理目录权限与访问能力正常。" : "管理目录权限或归属无效。",
        );
    } catch {
        add("control-directory", "fail", "管理目录不存在或不可访问，未自动创建或修复。");
    }
    let expectedPid: number | null = null;
    if (target.kind === "service") {
        try {
            const state = await (dependencies.inspectService ?? inspectManagerServiceStatus)(
                target.scope,
                host,
            );
            expectedPid = state.manager.pid;
            add(
                "system-service",
                !state.diagnostic &&
                    !state.serviceRecoveryRequired &&
                    state.manager.state !== "failed"
                    ? "pass"
                    : "fail",
                "系统服务身份、状态与操作记录检查。",
            );
            if (
                !state.diagnostic &&
                !state.serviceRecoveryRequired &&
                state.manager.state === "stopped"
            ) {
                add(
                    "manager-offline",
                    "warn",
                    "管理服务已停止；未启动服务，在线配置与Web检查未执行。",
                );
                return result();
            }
        } catch {
            add("system-service", "fail", "系统服务状态无法确认。");
        }
    }
    try {
        const inspect = dependencies.inspectDiagnostics ?? inspectManagerDiagnostics;
        const before = await inspect(target.workspace);
        if (target.kind === "service" && expectedPid !== before.manager.pid) {
            add("manager-identity", "fail", "管理 IPC 与系统服务进程不匹配，未继续探测。");
            return result();
        }
        add("manager", "pass", "常驻管理服务可达。");
        const desiredMismatch =
            (before.gateway.actual === "running" && before.gateway.desired === "stopped") ||
            (before.gateway.actual === "stopped" && before.gateway.desired === "running");
        add(
            "gateway",
            before.gateway.actual === "failed" || before.gateway.recoveryRequired || desiredMismatch
                ? "fail"
                : ["starting", "stopping"].includes(before.gateway.actual)
                  ? "warn"
                  : "pass",
            `网关实际状态：${before.gateway.actual}；期望状态：${before.gateway.desired}。`,
        );
        add(
            "configuration",
            before.configuration.state === "ready" && !before.configuration.recoveryRequired
                ? "pass"
                : "fail",
            before.configuration.state === "damaged"
                ? "配置损坏，管理端仍可用于修复。"
                : "配置来源与应用恢复状态检查（不加载插件）。",
        );
        add(
            "generation",
            before.generation.recoveryRequired ? "fail" : "pass",
            before.generation.activeId === null
                ? "使用内置运行版本，空实例无需安装扩展。"
                : "已选择不可变运行版本。",
        );
        for (const key of ["dataDirectory", "database"] as const) {
            const value = before.storage[key];
            add(
                key === "database" ? "database-access" : "data-directory",
                value === "ready" || value === "creatable" ? "pass" : "fail",
                value === "creatable"
                    ? "尚未初始化，已确认可创建；诊断未创建任何文件。"
                    : value === "ready"
                      ? "文件类型、归属与访问权限检查通过。"
                      : "存储路径无效或无法确认，未修改权限。",
            );
        }
        add(
            "public-static",
            before.storage.publicStatic === "invalid"
                ? "fail"
                : before.storage.publicStatic === "unavailable"
                  ? "warn"
                  : "pass",
            before.storage.publicStatic === "disabled"
                ? "未启用用户静态目录。"
                : "用户静态目录的边界与可读性检查。",
        );
        add(
            "extension-receipt",
            before.extensions.receipt === "invalid"
                ? "fail"
                : before.extensions.receipt === "unavailable"
                  ? "warn"
                  : "pass",
            before.extensions.receipt === "verified"
                ? "运行计划、锁文件、Schema 与宿主清单匹配既有收据；未重新运行插件。"
                : before.extensions.receipt === "bundled"
                  ? "当前使用内置宿主。"
                  : "扩展运行收据无效或无法确认。",
        );
        add(
            "extension-selection",
            before.extensions.selection === "ready"
                ? "pass"
                : before.extensions.selection === "mismatch"
                  ? "fail"
                  : "warn",
            "启动扩展选择与已验证清单的一致性检查，不替代账号配置校验。",
        );
        add(
            "extension-registration",
            before.extensions.registration === "verified" ||
                (before.extensions.receipt === "bundled" && before.extensions.selection === "ready")
                ? "pass"
                : "warn",
            before.extensions.registration === "verified"
                ? "匹配既有注册验证证据，诊断未导入插件。"
                : before.extensions.receipt === "bundled" && before.extensions.selection === "ready"
                  ? "空启动选择无需扩展注册验证。"
                  : "缺少匹配的注册验证证据，未运行插件来补做校验。",
        );
        add(
            "process-ownership",
            before.processOwnership.available ? "pass" : "fail",
            "管理服务进程所有权证据检查。",
        );
        add(
            "migration",
            before.serviceMigration.pending || before.serviceMigration.recoveryRequired
                ? "fail"
                : "pass",
            "服务迁移恢复状态检查。",
        );
        checks.push(...(await (dependencies.probe ?? probeManagerWeb)(before)));
        const after = await inspect(target.workspace);
        if (!isDeepStrictEqual(before, after))
            add("manager-identity", "fail", "检查期间管理实例或监听地址改变，请重新诊断。");
        add(
            "database-integrity",
            before.storage.database === "creatable" ? "pass" : "warn",
            before.storage.database === "creatable"
                ? "数据库尚未创建，无现存数据库需要完整性检查。"
                : "本次只检查数据库文件与目录访问边界，未打开 SQLite 执行完整性检查。",
        );
    } catch {
        add("manager", "fail", "管理诊断不可达或响应无效；未回退旧登录和插件加载路径。");
    }
    return result();
}
