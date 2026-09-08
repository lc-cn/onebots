import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import type { ControlStatus } from "@onebots/core/control";
import { createLocalControlTransport } from "./client/local-control.js";
import { controlSocket } from "./control/workspace.js";

export interface MigrationManagerState extends Pick<ControlStatus, "schemaVersion" | "manager"> {
    manager: ControlStatus["manager"] & { pid: number };
    gateway: Pick<ControlStatus["gateway"], "desired" | "actual" | "recoveryRequired"> & {
        instance?: { id: string; pid: number; address: { host: "127.0.0.1"; port: number } };
    };
    serviceMigration: { pending: boolean; recoveryRequired: boolean };
    knownConfigurationFailure: boolean;
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
function privateSocket(workspace: string): string {
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
    };
}
export async function inspectMigrationManager(workspace: string): Promise<MigrationManagerState> {
    try {
        const identity = privateSocket(workspace);
        const response = await createLocalControlTransport(workspace).request<unknown>(
            "GET",
            "/api/control/status",
        );
        if (privateSocket(workspace) !== identity) throw failure();
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
        const identity = privateSocket(workspace);
        const response = object(
            await createLocalControlTransport(workspace).request<unknown>(
                "POST",
                "/api/control/service-migration/release",
                { operationId },
            ),
        );
        if (
            privateSocket(workspace) !== identity ||
            Object.keys(response).length !== 1 ||
            response.released !== true
        )
            throw failure();
    } catch {
        throw failure();
    }
}
