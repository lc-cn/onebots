import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import type { ControlStatus } from "@onebots/core/control";
import { createLocalControlTransport } from "./client/local-control.js";
import { controlSocket } from "./control/workspace.js";
import { isDeepStrictEqual } from "node:util";
import { WindowsHostControlClient } from "./windows-host-control-client.js";
import { WINDOWS_HOST_PIPE_NAME, type WindowsNativeStatus } from "./service-platform-windows.js";

export interface MigrationManagerState extends Pick<ControlStatus, "schemaVersion" | "manager"> {
    manager: ControlStatus["manager"] & { pid: number };
    gateway: Pick<ControlStatus["gateway"], "desired" | "actual" | "recoveryRequired"> & {
        instance?: { id: string; pid: number; address: { host: "127.0.0.1"; port: number } };
    };
    serviceMigration: { pending: boolean; recoveryRequired: boolean };
    knownConfigurationFailure: boolean;
    accounts?: NonNullable<ControlStatus["accounts"]>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = () => new Error("本地迁移管理服务状态无法确认，请保留现场并对账");
function object(value: unknown): Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw failure();
    return value as Record<string, unknown>;
}
export function inspectPrivateControlSocket(workspace: string): string {
    if (
        process.platform === "win32" ||
        !path.isAbsolute(workspace) ||
        /[\u0000\r\n]/.test(workspace) ||
        !process.getuid
    )
        throw failure();
    const root = path.resolve(workspace);
    if (fs.realpathSync(root) !== root) throw failure();
    const directory = path.join(root, ".control");
    const socket = controlSocket(root);
    const parent = fs.lstatSync(directory),
        entry = fs.lstatSync(socket);
    if (
        !parent.isDirectory() ||
        !entry.isSocket() ||
        fs.realpathSync(directory) !== directory ||
        parent.uid !== process.getuid() ||
        entry.uid !== process.getuid() ||
        (parent.mode & 0o7777) !== 0o700 ||
        (entry.mode & 0o7777) !== 0o600
    )
        throw failure();
    return [parent.dev, parent.ino, entry.dev, entry.ino].join(":");
}
function parseStatus(input: unknown): MigrationManagerState {
    const value = object(input),
        manager = object(value.manager),
        gateway = object(value.gateway);
    const migration = object(value.serviceMigration);
    if (
        value.schemaVersion !== 1 ||
        typeof manager.id !== "string" ||
        !UUID.test(manager.id) ||
        typeof manager.version !== "string" ||
        semver.valid(manager.version) !== manager.version ||
        typeof manager.pid !== "number" ||
        !Number.isInteger(manager.pid) ||
        manager.pid < 1 ||
        manager.pid > 2147483647 ||
        typeof gateway.desired !== "string" ||
        !["running", "stopped"].includes(gateway.desired) ||
        typeof gateway.actual !== "string" ||
        !["starting", "running", "stopping", "stopped", "failed"].includes(
            String(gateway.actual),
        ) ||
        typeof gateway.recoveryRequired !== "boolean" ||
        typeof migration.pending !== "boolean" ||
        typeof migration.recoveryRequired !== "boolean" ||
        (gateway.error !== undefined && typeof gateway.error !== "string")
    )
        throw failure();
    let instance: MigrationManagerState["gateway"]["instance"];
    if (gateway.instance !== undefined) {
        const raw = object(gateway.instance),
            address = object(raw.address);
        if (
            typeof raw.id !== "string" ||
            !UUID.test(raw.id) ||
            typeof raw.pid !== "number" ||
            !Number.isInteger(raw.pid) ||
            raw.pid < 1 ||
            raw.pid > 2147483647 ||
            address.host !== "127.0.0.1" ||
            typeof address.port !== "number" ||
            !Number.isInteger(address.port) ||
            address.port < 1 ||
            address.port > 65535
        )
            throw failure();
        instance = { id: raw.id, pid: raw.pid, address: { host: "127.0.0.1", port: address.port } };
    }
    if (gateway.actual === "running" && !instance) throw failure();
    const accounts = parseAccountStatuses(value.accounts);
    return {
        schemaVersion: 1,
        manager: { id: manager.id, version: manager.version, pid: manager.pid },
        gateway: {
            desired: gateway.desired as MigrationManagerState["gateway"]["desired"],
            actual: gateway.actual as MigrationManagerState["gateway"]["actual"],
            recoveryRequired: gateway.recoveryRequired,
            ...(instance ? { instance } : {}),
        },
        serviceMigration: {
            pending: migration.pending,
            recoveryRequired: migration.recoveryRequired,
        },
        // Driver在prepare失败且确认没有fork子进程时保留这两条固定文案；其它failed绝不猜测。
        knownConfigurationFailure:
            gateway.actual === "failed" &&
            !gateway.recoveryRequired &&
            !instance &&
            [
                "网关配置无法读取或解析，请检查工作区配置",
                "网关配置必须是 YAML 对象，管理服务仍可用于修复",
            ].includes(gateway.error as string),
        accounts,
    };
}

function parseAccountStatuses(input: unknown): NonNullable<ControlStatus["accounts"]> {
    // 允许从尚未发布账号摘要的同架构旧 patch 管理服务读取状态。
    if (input === undefined) return { available: false, items: [] };
    if (!input || typeof input !== "object" || Array.isArray(input)) throw failure();
    const value = input as Record<string, unknown>;
    if (
        typeof value.available !== "boolean" ||
        !Array.isArray(value.items) ||
        value.items.length > 1000
    )
        throw failure();
    const items: NonNullable<ControlStatus["accounts"]>["items"] = [];
    for (const inputItem of value.items) {
        const item = object(inputItem);
        if (
            Object.keys(item).length !== 3 ||
            !safeIdentifier(item.platform) ||
            !safeIdentifier(item.accountId) ||
            !isAccountStatus(item.status)
        )
            throw failure();
        items.push({
            platform: item.platform,
            accountId: item.accountId,
            status: item.status,
        });
    }
    if (!value.available && items.length > 0) throw failure();
    return { available: value.available, items };
}

function isAccountStatus(value: unknown): value is "pending" | "online" | "offline" {
    return typeof value === "string" && ["pending", "online", "offline"].includes(value);
}

function safeIdentifier(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 512 &&
        !/[\p{Cc}\p{Cf}]/u.test(value)
    );
}

function stableWindowsManagerIdentity(status: WindowsNativeStatus):
    | (Pick<WindowsNativeStatus["state"], "service" | "manager" | "startedAt"> & {
          control: NonNullable<WindowsNativeStatus["state"]["control"]>;
      })
    | null {
    const control = status.state.control;
    if (!control) return null;
    return {
        service: status.state.service,
        manager: status.state.manager,
        startedAt: status.state.startedAt,
        control: {
            ...control,
            // 心跳发布可在只读请求期间合法推进；身份与网关状态必须保持稳定。
            revision: 0,
            publishedAt: "",
        },
    };
}

export async function inspectMigrationManager(workspace: string): Promise<MigrationManagerState> {
    try {
        if (process.platform === "win32") {
            if (!path.win32.isAbsolute(workspace) || /[\u0000\r\n]/.test(workspace))
                throw failure();
            const client = new WindowsHostControlClient(WINDOWS_HOST_PIPE_NAME);
            const before = await client.status();
            const response = await client.request<unknown>("GET", "/api/control/status");
            const after = await client.status();
            const manager = parseStatus(response.body);
            const beforeIdentity = stableWindowsManagerIdentity(before);
            const afterIdentity = stableWindowsManagerIdentity(after);
            const control = after.state.control;
            if (
                response.status < 200 ||
                response.status >= 300 ||
                !beforeIdentity ||
                !afterIdentity ||
                !control ||
                !isDeepStrictEqual(beforeIdentity, afterIdentity) ||
                control.manager.id !== manager.manager.id ||
                control.manager.version !== manager.manager.version ||
                control.manager.pid !== manager.manager.pid ||
                control.gateway.desired !== manager.gateway.desired ||
                control.gateway.actual !== manager.gateway.actual
            )
                throw failure();
            return manager;
        }
        const identity = inspectPrivateControlSocket(workspace);
        const response = await createLocalControlTransport(workspace).request<unknown>(
            "GET",
            "/api/control/status",
        );
        if (inspectPrivateControlSocket(workspace) !== identity) throw failure();
        return parseStatus(response);
    } catch {
        throw failure();
    }
}
export async function releaseMigrationManager(
    workspace: string,
    operationId: string,
): Promise<void> {
    try {
        if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId))
            throw failure();
        const identity = inspectPrivateControlSocket(workspace);
        const response = object(
            await createLocalControlTransport(workspace).request<unknown>(
                "POST",
                "/api/control/service-migration/release",
                { operationId },
            ),
        );
        if (
            inspectPrivateControlSocket(workspace) !== identity ||
            Object.keys(response).length !== 1 ||
            response.released !== true
        )
            throw failure();
    } catch {
        throw failure();
    }
}
