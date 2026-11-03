import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { planWorkspaceRegistration } from "./registration-plan.js";
import { registerWorkspace, resumeWorkspaceRegistration } from "./registration.js";
import { acquireWorkspaceAdmission, inspectWorkspaceAdmission } from "./admission.js";
import { AuthorityRegistry } from "./registry.js";
import { startControlHost } from "../control/host.js";
import { createLocalControlClient } from "../client/local-control.js";
import { DatabaseSync } from "node:sqlite";
import { isLocalVirtiofsMount } from "./files.js";

const posix = it.skipIf(process.platform === "win32");
const roots: string[] = [];
const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const close of closes.splice(0).reverse()) await close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const parent = fs.realpathSync(fs.mkdtempSync("/tmp/oba-"));
    roots.push(parent);
    const workspace = path.join(parent, "workspace"),
        authority = path.join(parent, "authority");
    fs.mkdirSync(workspace, { mode: 0o700 });
    return { parent, workspace, authority };
}
async function registered() {
    const f = fixture();
    const plan = await planWorkspaceRegistration(f.workspace, f.authority, { desired: "stopped" });
    await registerWorkspace(plan, plan.digest);
    return { ...f, plan };
}
function snapshot(directory: string): Record<string, string> {
    const result: Record<string, string> = {};
    const visit = (root: string) => {
        for (const item of fs.readdirSync(root, { withFileTypes: true })) {
            const file = path.join(root, item.name);
            if (item.isDirectory()) visit(file);
            else if (item.isFile() && !item.name.startsWith("manager-lock.sqlite"))
                result[path.relative(directory, file)] = fs.readFileSync(file).toString("base64");
        }
    };
    visit(directory);
    return result;
}
function copyWorkspace(from: string, to: string): void {
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    const modes = (source: string, destination: string) => {
        fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
        if (fs.statSync(source).isDirectory())
            for (const name of fs.readdirSync(source))
                modes(path.join(source, name), path.join(destination, name));
    };
    modes(from, to);
    expect(fs.statSync(path.join(to, ".control")).mode & 0o777).toBe(0o700);
}

posix("计划只读，明确登记不启动网关；同对象重开保持身份", async () => {
    const f = fixture();
    const plan = await planWorkspaceRegistration(f.workspace, f.authority);
    expect(plan.impact).toContain("撤销全部旧管理会话");
    expect(plan.impact).toContain("不启动管理服务或网关");
    expect(fs.readdirSync(f.workspace)).toEqual([]);
    expect(fs.existsSync(f.authority)).toBe(false);
    await expect(registerWorkspace(plan, "wrong")).rejects.toThrow("确认");
    expect(fs.readdirSync(f.workspace)).toEqual([]);
    await registerWorkspace(plan, plan.digest);
    expect(fs.existsSync(path.join(f.workspace, "config.yaml"))).toBe(false);
    expect(inspectWorkspaceAdmission(f.workspace, f.authority).state).toBe("verified");
    const before = snapshot(f.workspace);
    const first = acquireWorkspaceAdmission(f.workspace, f.authority);
    expect(first.inspection.state).toBe("verified");
    expect(acquireWorkspaceAdmission(f.workspace, f.authority).inspection.state).not.toBe(
        "verified",
    );
    first.release();
    const next = acquireWorkspaceAdmission(f.workspace, f.authority);
    expect(next.binding).toEqual(first.binding);
    next.release();
    expect(snapshot(f.workspace)).toEqual(before);
});

posix("保留权限复制在原件运行和停止时都不能取得同一身份；跨authority不补建", async () => {
    const f = await registered();
    const copy = path.join(f.parent, "copy");
    copyWorkspace(f.workspace, copy);
    const original = acquireWorkspaceAdmission(f.workspace, f.authority);
    const before = snapshot(copy);
    expect(acquireWorkspaceAdmission(copy, f.authority).inspection.state).toBe("binding-mismatch");
    original.release();
    expect(acquireWorkspaceAdmission(copy, f.authority).inspection.reason).toBe(
        "DIRECTORY_IDENTITY_MISMATCH",
    );
    const missingAuthority = path.join(f.parent, "other-authority");
    expect(acquireWorkspaceAdmission(copy, missingAuthority).inspection.state).toBe(
        "authority-unavailable",
    );
    expect(fs.existsSync(missingAuthority)).toBe(false);
    expect(snapshot(copy)).toEqual(before);
    await expect(planWorkspaceRegistration(copy, missingAuthority)).rejects.toThrow("已有来源绑定");
});

posix("不同已登记工作区可并行；移动路径而非复制保持物理身份", async () => {
    const f = await registered();
    const other = path.join(f.parent, "other");
    fs.mkdirSync(other, { mode: 0o700 });
    const plan = await planWorkspaceRegistration(other, f.authority, { desired: "stopped" });
    await registerWorkspace(plan, plan.digest);
    const first = acquireWorkspaceAdmission(f.workspace, f.authority);
    const second = acquireWorkspaceAdmission(other, f.authority);
    expect([first.inspection.state, second.inspection.state]).toEqual(["verified", "verified"]);
    first.release();
    second.release();
    const renamed = path.join(f.parent, "renamed");
    fs.renameSync(f.workspace, renamed);
    const lease = acquireWorkspaceAdmission(renamed, f.authority);
    expect(lease.inspection.state).toBe("verified");
    lease.release();
});

posix("引用发布后屏障失败仍保持prepared；显式续办同一请求后才允许运行", async () => {
    const f = fixture();
    const plan = await planWorkspaceRegistration(f.workspace, f.authority, { desired: "stopped" });
    const link = fs.linkSync.bind(fs);
    const failure = vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
        link(from, to);
        if (String(to).endsWith("workspace-binding.json"))
            throw new Error("injected publication acknowledgement loss");
    });
    await expect(registerWorkspace(plan, plan.digest)).rejects.toThrow("injected");
    failure.mockRestore();
    expect(inspectWorkspaceAdmission(f.workspace, f.authority).state).toBe("registration-pending");
    expect(acquireWorkspaceAdmission(f.workspace, f.authority).inspection.state).toBe(
        "registration-pending",
    );
    await resumeWorkspaceRegistration(f.workspace, f.authority, plan.requestId);
    expect(inspectWorkspaceAdmission(f.workspace, f.authority).state).toBe("verified");
    const before = snapshot(f.workspace);
    await resumeWorkspaceRegistration(f.workspace, f.authority, plan.requestId);
    expect(snapshot(f.workspace)).toEqual(before);
});

posix("prepared后第三种认证状态不被覆盖，未知操作不换身份", async () => {
    const f = fixture();
    const plan = await planWorkspaceRegistration(f.workspace, f.authority, { desired: "stopped" });
    const prepare = AuthorityRegistry.prototype.prepare;
    const failure = vi
        .spyOn(AuthorityRegistry.prototype, "prepare")
        .mockImplementation(function (record) {
            prepare.call(this, record);
            throw new Error("injected prepared");
        });
    await expect(registerWorkspace(plan, plan.digest)).rejects.toThrow("injected prepared");
    failure.mockRestore();
    expect(inspectWorkspaceAdmission(f.workspace, f.authority).state).toBe("registration-pending");
    const auth = path.join(f.workspace, ".control/auth.json");
    fs.writeFileSync(auth, "{unknown}", { mode: 0o600 });
    await expect(
        resumeWorkspaceRegistration(f.workspace, f.authority, plan.requestId),
    ).rejects.toThrow();
    expect(fs.readFileSync(auth, "utf8")).toBe("{unknown}");
    const registry = AuthorityRegistry.open(f.authority);
    try {
        expect(registry.findById(plan.requestId)?.status).toBe("prepared");
    } finally {
        registry.close();
    }
    expect(acquireWorkspaceAdmission(f.workspace, f.authority).inspection.state).not.toBe(
        "verified",
    );
});

posix("丢.control但保留业务配置不算新安装；authority权限异常不修复", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.workspace, "config.yaml"), "plugins: {}\n");
    await expect(planWorkspaceRegistration(f.workspace, f.authority)).rejects.toThrow(
        "关闭证据不足",
    );
    expect(fs.existsSync(path.join(f.workspace, ".control"))).toBe(false);
    const valid = await registered();
    fs.chmodSync(valid.authority, 0o755);
    expect(acquireWorkspaceAdmission(valid.workspace, valid.authority).inspection.state).not.toBe(
        "verified",
    );
    expect(fs.statSync(valid.authority).mode & 0o777).toBe(0o755);
});

posix("拒绝态Web和本地IPC均隔离旧会话，启动/关闭不改业务文件", async () => {
    const f = await registered();
    const copy = path.join(f.parent, "copy");
    copyWorkspace(f.workspace, copy);
    const before = snapshot(copy);
    const host = await startControlHost({
        workspace: copy,
        authorityDirectory: f.authority,
        port: 0,
    });
    closes.push(host.close);
    expect(host.admission.state).toBe("binding-mismatch");
    expect(host.controller).toBeUndefined();
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("missing test listener");
    const origin = `http://127.0.0.1:${address.port}`;
    const page = await fetch(origin).then(response => response.text());
    expect(page).toContain("工作区暂未取得运行权");
    expect(page).toContain("当前目录与原登记不匹配");
    expect(page).not.toMatch(/<form|type="password"|src="\/assets\/.*\.js/);
    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
    expect((await fetch(`${origin}/api/control/workspace-admission`)).status).toBe(200);
    for (const route of [
        "/api/control/status",
        "/api/control/config/source",
        "/api/control/auth/bootstrap",
        "/api/control/terminal",
    ]) {
        expect(
            (await fetch(origin + route, { headers: { Authorization: "Bearer copied-token" } }))
                .status,
        ).toBe(503);
    }
    await expect(createLocalControlClient(copy).bootstrap()).rejects.toThrow("来源尚未验证");
    await expect(createLocalControlClient(copy).gateway("start")).rejects.toThrow("来源尚未验证");
    await host.close();
    expect(snapshot(copy)).toEqual(before);
});

posix("新卷先诊断再显式登记，以及不同hostname下精确初始种子均可运行", async () => {
    const f = fixture();
    vi.stubEnv("ONEBOTS_BOOTSTRAP_CODE", "synthetic-bootstrap-input");
    vi.stubEnv("ONEBOTS_RECOVERY_CODE", "synthetic-recovery-input");
    const blocked = await startControlHost({
        workspace: f.workspace,
        authorityDirectory: f.authority,
        port: 0,
    });
    expect(blocked.admission.state).toBe("unbound");
    expect(process.env.ONEBOTS_BOOTSTRAP_CODE).toBeUndefined();
    expect(process.env.ONEBOTS_RECOVERY_CODE).toBeUndefined();
    expect(fs.existsSync(path.join(f.workspace, ".control/auth.json"))).toBe(false);
    await blocked.close();
    expect(fs.readdirSync(f.workspace)).toEqual([".control"]);
    const plan = await planWorkspaceRegistration(f.workspace, f.authority, { desired: "stopped" });
    await registerWorkspace(plan, plan.digest);
    const hostname = vi.spyOn(os, "hostname").mockReturnValue("different-registration-container");
    const host = await startControlHost({
        workspace: f.workspace,
        authorityDirectory: f.authority,
        port: 0,
    });
    closes.push(host.close);
    expect(host.admission.state).toBe("verified");
    expect((await createLocalControlClient(f.workspace).status()).processOwnership.available).toBe(
        true,
    );
    expect(host.controller?.status().actual).toBe("stopped");
    await host.close();
    hostname.mockRestore();
});

posix("计划后出现的未知authority数据库不能被补表或接管", async () => {
    const f = fixture();
    const plan = await planWorkspaceRegistration(f.workspace, f.authority);
    fs.mkdirSync(f.authority, { mode: 0o700 });
    const file = path.join(f.authority, "authority.sqlite");
    fs.writeFileSync(file, "", { mode: 0o600 });
    const unknown = new DatabaseSync(file);
    unknown.exec("CREATE TABLE unrelated (id INTEGER)");
    unknown.close();
    const before = fs.readFileSync(file);
    await expect(registerWorkspace(plan, plan.digest)).rejects.toThrow();
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(f.authority)).toEqual(["authority.sqlite"]);
    expect(fs.existsSync(path.join(f.workspace, ".control/workspace-binding.json"))).toBe(false);
});

it("同一FUSE magic下区分本地virtiofs和更深的bucket挂载，未知挂载格式不自证", () => {
    const local = "1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / /data rw - virtiofs mac rw\n";
    expect(isLocalVirtiofsMount("/data/.control", local)).toBe(true);
    expect(
        isLocalVirtiofsMount(
            "/data/.control",
            local + "3 2 0:3 / /data/.control rw - fuse.s3fs bucket rw\n",
        ),
    ).toBe(false);
    expect(isLocalVirtiofsMount("/data/.control", "unknown format\n")).toBe(false);
    expect(
        isLocalVirtiofsMount(
            "/data with space/.control",
            "2 1 0:2 / /data\\040with\\040space rw - virtiofs mac rw\n",
        ),
    ).toBe(true);
});
