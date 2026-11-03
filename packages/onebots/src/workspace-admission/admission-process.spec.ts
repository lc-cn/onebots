import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { planWorkspaceRegistration } from "./registration-plan.js";
import { registerWorkspace, resumeWorkspaceRegistration } from "./registration.js";
import { AuthorityRegistry } from "./registry.js";
import { acquireWorkspaceAdmission } from "./admission.js";
import { allocateConfigurationVerification } from "../configuration/configuration-verify-ownership.js";

const run = promisify(execFile);
const posix = it.skipIf(process.platform === "win32");
const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

posix.each(["gateway.json", "process-ownership.json"])(
    "legacy登记中断后%s虽仍静止但已不是确认的旧证明，续办不覆盖或继续",
    async name => {
        const f = fixture();
        await legacyWorkspace(f.workspace);
        const plan = await planWorkspaceRegistration(f.workspace, f.authority);
        const prepare = AuthorityRegistry.prototype.prepare;
        const interrupted = vi
            .spyOn(AuthorityRegistry.prototype, "prepare")
            .mockImplementation(function (record) {
                prepare.call(this, record);
                throw new Error("injected prepared pause");
            });
        await expect(registerWorkspace(plan, plan.digest)).rejects.toThrow("injected");
        interrupted.mockRestore();
        const file = path.join(f.workspace, ".control", name);
        const state = JSON.parse(fs.readFileSync(file, "utf8"));
        if (name === "gateway.json") state.desired = "running";
        else state.managerId = "11111111-1111-4111-8111-111111111111";
        fs.writeFileSync(file, JSON.stringify(state));
        const before = fs.readFileSync(file);
        await expect(
            resumeWorkspaceRegistration(f.workspace, f.authority, plan.requestId),
        ).rejects.toThrow("已变化");
        expect(fs.readFileSync(file)).toEqual(before);
        expect(fs.existsSync(path.join(f.workspace, ".control/auth.json"))).toBe(false);
        const registry = AuthorityRegistry.open(f.authority);
        try {
            expect(registry.findById(plan.requestId)?.status).toBe("prepared");
        } finally {
            registry.close();
        }
    },
);
const lib = path.resolve(import.meta.dirname, "../../lib");
function fixture() {
    const parent = fs.realpathSync(fs.mkdtempSync("/tmp/ob-provenance-"));
    directories.push(parent);
    const workspace = path.join(parent, "workspace"),
        authority = path.join(parent, "authority");
    fs.mkdirSync(workspace, { mode: 0o700 });
    return { parent, workspace, authority };
}
async function legacyWorkspace(workspace: string) {
    // 使用历史进程 Module 的真实公开生命周期建立v1 closed证据；子进程确已退出，不伪造PID。
    await run(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
        import {randomUUID} from 'node:crypto';
        import {acquireControlWorkspace} from ${JSON.stringify(new URL(`file://${lib}/control/workspace.js`).href)};
        import {claimServiceProcessOwnership,closeServiceProcessOwnership} from ${JSON.stringify(new URL(`file://${lib}/service-migration-processes.js`).href)};
        import {GatewayController} from ${JSON.stringify(new URL(`file://${lib}/control/gateway-controller.js`).href)};
        const root=process.argv[1], release=acquireControlWorkspace(root), id=randomUUID();
        try {
            if(!await claimServiceProcessOwnership(root,id,true))throw new Error('seed rejected');
            const gateway=new GatewayController({statePath:root+'/.control/gateway.json',initialDesired:'stopped',driver:{start(){throw new Error('forbidden')},async stop(){}}});
            await gateway.initialize();
            await closeServiceProcessOwnership(root,id);
        }finally{release()}
    `,
            workspace,
        ],
        { timeout: 10_000 },
    );
}

posix("真实退出的v1工作区保留正常失败安装历史也可显式首登，损坏配置操作不被当已完成", async () => {
    const f = fixture();
    await legacyWorkspace(f.workspace);
    const installations = path.join(f.workspace, ".control/installations");
    fs.mkdirSync(installations, { mode: 0o700 });
    fs.writeFileSync(
        path.join(installations, "previous-install.json"),
        JSON.stringify({
            schemaVersion: 1,
            id: "previous-install",
            phase: "failed",
            planDigest: "a".repeat(64),
            createdAt: "2026-01-01T00:00:00.000Z",
            finishedAt: "2026-01-01T00:00:01.000Z",
            error: "DOWNLOAD_FAILED",
        }),
        { mode: 0o600 },
    );
    const plans = await planWorkspaceRegistration(f.workspace, f.authority);
    expect(plans.kind).toBe("legacy");
    const configuration = path.join(f.workspace, ".control/configuration-applications");
    fs.mkdirSync(configuration, { mode: 0o700 });
    const corrupt = path.join(configuration, "fake-complete.json");
    fs.writeFileSync(corrupt, JSON.stringify({ status: "succeeded" }), { mode: 0o600 });
    const before = fs.readFileSync(corrupt);
    await expect(planWorkspaceRegistration(f.workspace, f.authority)).rejects.toThrow();
    expect(fs.readFileSync(corrupt)).toEqual(before);
    // 删除本测试故意制造的损坏记录，回到原真实已关闭夹具；不改变产品恢复逻辑。
    fs.unlinkSync(corrupt);
    const receipt = fs.readFileSync(path.join(f.workspace, ".control/process-ownership.json"));
    await registerWorkspace(plans, plans.digest);
    expect(fs.readFileSync(path.join(f.workspace, ".control/process-ownership.json"))).toEqual(
        receipt,
    );
    const lease = acquireWorkspaceAdmission(f.workspace, f.authority);
    expect(lease.inspection.state).toBe("verified");
    lease.release();
});

posix("独立进程持有身份运行锁时副本被拒绝，进程退出后仍按对象身份拒绝副本", async () => {
    const f = fixture();
    const plan = await planWorkspaceRegistration(f.workspace, f.authority, { desired: "stopped" });
    await registerWorkspace(plan, plan.digest);
    const copy = path.join(f.parent, "copy");
    fs.cpSync(f.workspace, copy, { recursive: true });
    fs.chmodSync(copy, 0o700);
    fs.chmodSync(path.join(copy, ".control"), 0o700);
    const child = spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
        import {acquireControlWorkspace} from ${JSON.stringify(new URL(`file://${lib}/control/workspace.js`).href)};
        import {acquireWorkspaceAdmission} from ${JSON.stringify(new URL(`file://${lib}/workspace-admission/admission.js`).href)};
        const release=acquireControlWorkspace(process.argv[1]);
        const lease=acquireWorkspaceAdmission(process.argv[1],process.argv[2]);
        if(lease.inspection.state!=='verified')process.exit(2);
        const timer=setInterval(()=>{},1000);
        process.once('SIGTERM',()=>{clearInterval(timer);lease.release();release();process.exit(0)});
        process.stdout.write('ready'+String.fromCharCode(10));
    `,
            f.workspace,
            f.authority,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    try {
        const ready = await Promise.race([
            once(child.stdout!, "data").then(([data]) => String(data).trim()),
            exited.then(() => "exited"),
        ]);
        expect(ready).toBe("ready");
        expect(acquireWorkspaceAdmission(copy, f.authority).inspection.reason).toBe(
            "IDENTITY_LOCK_UNAVAILABLE",
        );
    } finally {
        child.kill("SIGTERM");
        await exited;
    }
    expect(acquireWorkspaceAdmission(copy, f.authority).inspection.reason).toBe(
        "DIRECTORY_IDENTITY_MISMATCH",
    );
    const original = acquireWorkspaceAdmission(f.workspace, f.authority);
    expect(original.inspection.state).toBe("verified");
    original.release();
});

posix.each(["activation-verification-workers", "application-verification-workers"])(
    "v1真实关闭后残留%s的活parent或foreign owner均拒绝登记",
    async relative => {
        const f = fixture();
        await legacyWorkspace(f.workspace);
        const { directory } = allocateConfigurationVerification(
            path.join(f.workspace, ".control", relative),
        );
        const file = path.join(directory, "owner.json");
        const original = fs.readFileSync(file);
        await expect(planWorkspaceRegistration(f.workspace, f.authority)).rejects.toThrow(
            "关闭证据不足",
        );
        expect(fs.readFileSync(file)).toEqual(original);
        const foreign = {
            ...JSON.parse(original.toString("utf8")),
            hostname: "foreign-container-owner",
        };
        fs.writeFileSync(file, JSON.stringify(foreign));
        await expect(planWorkspaceRegistration(f.workspace, f.authority)).rejects.toThrow(
            "关闭证据不足",
        );
        expect(fs.readFileSync(file, "utf8")).toBe(JSON.stringify(foreign));
    },
);
