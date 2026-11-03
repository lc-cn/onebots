import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { startControlHost } from "./host.js";
import { acquireControlWorkspace } from "./workspace.js";
import { createLocalControlClient } from "../client/local-control.js";
import {
    claimServiceProcessOwnership,
    verifyServiceMigrationProcesses,
} from "../service-migration-processes.js";
import {
    allocateConfigurationVerification,
    writeConfigurationVerificationOwner,
} from "../configuration/configuration-verify-ownership.js";

const posix = it.skipIf(process.platform === "win32");

const directories: string[] = [];
const hosts: Array<Awaited<ReturnType<typeof startControlHost>>> = [];
afterEach(async () => {
    try {
        for (const host of hosts.splice(0).reverse()) await host.close();
    } finally {
        vi.restoreAllMocks();
        for (const directory of directories.splice(0))
            fs.rmSync(directory, { recursive: true, force: true });
    }
});
function workspace() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-hostname-"));
    directories.push(root);
    return root;
}
async function start(root: string) {
    const host = await startControlHost({
        workspace: root,
        port: 0,
        gatewayEntrypoint: path.resolve(import.meta.dirname, "../../lib/gateway/entry.js"),
    });
    hosts.push(host);
    return { host, client: createLocalControlClient(root) };
}
function receipt(root: string) {
    const file = path.join(root, ".control/process-ownership.json");
    return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
}

posix("正常关闭后 hostname 改变，保留运行意图并恢复真实网关，不修改配置或配对身份", async () => {
    const root = workspace();
    const initial = await start(root);
    const initialStatus = await initial.client.status();
    expect(initialStatus.gateway.actual).toBe("running");
    const { code } = await initial.client.bootstrap();
    expect(code).toBeTruthy();
    const config = fs.readFileSync(path.join(root, "config.yaml"));
    const auth = fs.readFileSync(path.join(root, ".control/auth.json"));
    await initial.host.close();
    const closed = receipt(root);
    expect(closed.value.phase).toBe("closed");
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);

    const reopened = await start(root);
    const status = await reopened.client.status();
    expect(status.processOwnership).toEqual({ available: true });
    expect(status.gateway).toMatchObject({
        desired: "running",
        actual: "running",
        recoveryRequired: false,
    });
    expect(status.gateway.instance?.id).not.toBe(initialStatus.gateway.instance?.id);
    expect(receipt(root).value).toMatchObject({
        phase: "active",
        hostname: os.hostname(),
        managerId: status.manager.id,
    });
    expect(fs.readFileSync(path.join(root, "config.yaml"))).toEqual(config);
    expect(fs.readFileSync(path.join(root, ".control/auth.json"))).toEqual(auth);
});

posix("跨 hostname 接管保留 stopped 意图，不自动启动网关", async () => {
    const root = workspace();
    const initial = await start(root);
    expect((await initial.client.gateway("stop")).status).toBe("succeeded");
    await initial.host.close();
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    const reopened = await start(root);
    expect((await reopened.client.status()).gateway).toMatchObject({
        desired: "stopped",
        actual: "stopped",
    });
    expect((await reopened.client.status()).processOwnership).toEqual({ available: true });
});

posix.each(["active", "never-started"])(
    "跨 hostname 的 %s 记录仍拒绝接管且不改写证据",
    async phase => {
        const root = workspace();
        const initial = await start(root);
        await initial.host.close();
        const previous = receipt(root);
        fs.writeFileSync(
            previous.file,
            JSON.stringify({
                ...previous.value,
                phase,
                ...(phase === "never-started" ? { pid: null, managerId: null } : {}),
            }),
        );
        const before = fs.readFileSync(previous.file);
        vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
        const reopened = await start(root);
        expect((await reopened.client.status()).processOwnership).toEqual({ available: false });
        await expect(reopened.client.gateway("start")).rejects.toThrow(
            "历史管理进程所有权不可确认",
        );
        expect(fs.readFileSync(previous.file)).toEqual(before);
    },
);

posix("closed 历史 manager PID 在新容器复用时，不据此认定旧 manager 存活", async () => {
    const root = workspace();
    const initial = await start(root);
    await initial.host.close();
    const previous = receipt(root);
    // 模拟两个容器的 manager 都为 PID 1：新命名空间这个数字存在，但不是旧 manager。
    fs.writeFileSync(previous.file, JSON.stringify({ ...previous.value, pid: process.ppid }));
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    const release = acquireControlWorkspace(root);
    try {
        expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(true);
    } finally {
        release();
    }
});

posix("跨 hostname closed 只允许普通接管，不能作为迁移静止证明", async () => {
    const root = workspace();
    const initial = await start(root);
    await initial.host.close();
    const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(exited, "exit");
    const previous = receipt(root);
    fs.writeFileSync(previous.file, JSON.stringify({ ...previous.value, pid: exited.pid }));
    expect(await verifyServiceMigrationProcesses(root)).toBe(true);
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    expect(await verifyServiceMigrationProcesses(root)).toBe(false);
});

posix.each([{ actual: "failed", recoveryRequired: true }, { operations: [{ status: "running" }] }])(
    "closed 与未静止网关状态不一致时拒绝跨 hostname 接管 (%j)",
    async patch => {
        const root = workspace();
        const initial = await start(root);
        await initial.host.close();
        const gateway = path.join(root, ".control/gateway.json");
        fs.writeFileSync(
            gateway,
            JSON.stringify({ ...JSON.parse(fs.readFileSync(gateway, "utf8")), ...patch }),
        );
        const previous = receipt(root);
        const before = fs.readFileSync(previous.file);
        vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
        const release = acquireControlWorkspace(root);
        try {
            expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(false);
            expect(fs.readFileSync(previous.file)).toEqual(before);
        } finally {
            release();
        }
    },
);

posix("closed 跨 hostname 仍检查当前 hostname 的存活 worker，不清理或发信号", async () => {
    const root = workspace();
    const initial = await start(root);
    await initial.host.close();
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    const { directory, owner: allocation } = allocateConfigurationVerification(
        path.join(root, ".control/generation-verifications"),
    );
    const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(exited, "exit");
    writeConfigurationVerificationOwner(directory, {
        ...allocation,
        parentPid: exited.pid!,
        workerPid: process.pid,
        phase: "running",
    });
    const owner = path.join(directory, "owner.json");
    const before = fs.readFileSync(owner);
    const release = acquireControlWorkspace(root);
    try {
        expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(false);
        expect(fs.readFileSync(owner)).toEqual(before);
        writeConfigurationVerificationOwner(directory, {
            ...allocation,
            parentPid: exited.pid!,
            workerPid: exited.pid!,
            phase: "running",
        });
        expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(true);
    } finally {
        release();
    }
});

posix("跨 hostname closed 凭据权限异常不能自动修复或接管", async () => {
    const root = workspace();
    const initial = await start(root);
    await initial.host.close();
    const previous = receipt(root);
    fs.chmodSync(previous.file, 0o644);
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    const release = acquireControlWorkspace(root);
    try {
        expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(false);
        expect(fs.statSync(previous.file).mode & 0o777).toBe(0o644);
    } finally {
        release();
    }
});

posix("closed 即使记录的旧网关 PID 已退出，也不能跨 hostname 接管含实例的状态", async () => {
    const root = workspace();
    const initial = await start(root);
    await initial.host.close();
    const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(exited, "exit");
    const gateway = path.join(root, ".control/gateway.json");
    fs.writeFileSync(
        gateway,
        JSON.stringify({
            ...JSON.parse(fs.readFileSync(gateway, "utf8")),
            instance: { id: randomUUID(), pid: exited.pid },
        }),
    );
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    const release = acquireControlWorkspace(root);
    try {
        expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(false);
    } finally {
        release();
    }
});

posix("实际 closed 记录不替代残留旧 hostname worker 的归属证明", async () => {
    const root = workspace();
    const initial = await start(root);
    const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(exited, "exit");
    const { directory, owner } = allocateConfigurationVerification(
        path.join(root, ".control/generation-verifications"),
    );
    writeConfigurationVerificationOwner(directory, {
        ...owner,
        parentPid: exited.pid!,
        workerPid: exited.pid!,
        phase: "running",
    });
    await initial.host.close();
    expect(receipt(root).value.phase).toBe("closed");
    const before = fs.readFileSync(path.join(directory, "owner.json"));
    vi.spyOn(os, "hostname").mockReturnValue(`rebuilt-${randomUUID()}`);
    const release = acquireControlWorkspace(root);
    try {
        expect(await claimServiceProcessOwnership(root, randomUUID(), false)).toBe(false);
        expect(fs.readFileSync(path.join(directory, "owner.json"))).toEqual(before);
    } finally {
        release();
    }
});
