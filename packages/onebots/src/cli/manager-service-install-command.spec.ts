import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installManagerService } from "../manager-service-install.js";
import { installManagerServiceCommand } from "./manager-service-install-command.js";
import { options as installOptions } from "../commands/install.js";
import type { ManagerServiceSpec } from "../manager-service-spec.js";
import type { ManagerServiceRecord } from "../manager-service-journal.js";

vi.mock("../manager-service-install.js", () => ({ installManagerService: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(installManagerService).mockReset();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-install-cli-"));
    roots.push(root);
    vi.mocked(installManagerService).mockImplementation(async spec => record(spec));
    return root;
}
function record(
    spec: ManagerServiceSpec,
    overrides: Partial<ManagerServiceRecord> = {},
): ManagerServiceRecord {
    return {
        schemaVersion: 1,
        id: "install-test",
        action: "install",
        phase: "completed",
        status: "succeeded",
        recoveryRequired: false,
        desiredEnabled: true,
        managerSpec: spec,
        managerSpecDigest: "a".repeat(64),
        ...overrides,
    };
}
describe("首次管理服务安装CLI", () => {
    it("选项仅管理契约，默认目录/host/port明确，拒绝旧业务参数", () => {
        expect(installOptions.parse({})).toEqual({
            host: "127.0.0.1",
            port: 6727,
            system: false,
        });
        for (const key of ["config", "register", "protocol", "target"])
            expect(installOptions.safeParse({ [key]: "old" }).success).toBe(false);
    });
    it("工作区默认与serve/ui一致：显式路径优先环境变量，其次当前目录", async () => {
        const root = fixture();
        vi.stubEnv("ONEBOTS_WORKSPACE", undefined);
        await installManagerServiceCommand({});
        expect(vi.mocked(installManagerService).mock.calls.at(-1)?.[0].workspace).toBe(
            fs.realpathSync(process.cwd()),
        );
        vi.stubEnv("ONEBOTS_WORKSPACE", path.join(root, "from-env"));
        await installManagerServiceCommand({});
        expect(vi.mocked(installManagerService).mock.calls.at(-1)?.[0].workspace).toBe(
            path.join(root, "from-env"),
        );
        await installManagerServiceCommand({ dataDir: path.join(root, "explicit") });
        expect(vi.mocked(installManagerService).mock.calls.at(-1)?.[0].workspace).toBe(
            path.join(root, "explicit"),
        );
        expect(fs.existsSync(path.join(root, "from-env"))).toBe(false);
        expect(fs.existsSync(path.join(root, "explicit"))).toBe(false);
    });
    it("未来目录只读规范化，当前Node/bin/cwd形成serve契约且成功不宣称已运行", async () => {
        const root = fixture();
        const link = path.join(root, "ancestor-link");
        fs.symlinkSync(root, link);
        const future = path.join(link, "not-created", "工作 区");
        const output = await installManagerServiceCommand({ dataDir: future });
        const workspace = path.join(root, "not-created", "工作 区");
        expect(vi.mocked(installManagerService).mock.calls[0][0]).toEqual({
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            workingDirectory: fs.realpathSync(process.cwd()),
            nodePath: process.execPath,
            binPath: fileURLToPath(new URL("../bin.js", import.meta.url)),
            host: "127.0.0.1",
            port: 6727,
        });
        expect(fs.existsSync(path.join(root, "not-created"))).toBe(false);
        expect(output).toMatchObject({ exitCode: 0, output: expect.stringContaining("尚未启动") });
        expect(output.output).toContain("操作 install-test：succeeded（completed）");
        expect(output.output).toContain("onebots auth bootstrap --data-dir '" + workspace + "'");
        expect(output.output).toContain("onebots start\n");
    });
    it("已有坏业务YAML不读取，显式系统scope和监听值直接传递", async () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "config.yaml"), 'password: "private-secret');
        const read = vi.spyOn(fs, "readFileSync");
        const output = await installManagerServiceCommand({
            dataDir: root,
            system: true,
            host: "0.0.0.0",
            port: 7821,
        });
        expect(read).not.toHaveBeenCalled();
        expect(vi.mocked(installManagerService).mock.calls[0][0]).toMatchObject({
            scope: "system",
            host: "0.0.0.0",
            port: 7821,
        });
        expect(output.output).toContain("onebots start --system");
        expect(output.output).not.toContain("private-secret");
    });
    it("拒绝悬空祖先链接及非目录，不创建任何路径", async () => {
        const root = fixture();
        const link = path.join(root, "dangling");
        fs.symlinkSync(path.join(root, "missing"), link);
        const file = path.join(root, "file");
        fs.writeFileSync(file, "preserved");
        for (const directory of [link, path.join(link, "child"), file, path.join(file, "child")])
            expect(await installManagerServiceCommand({ dataDir: directory })).toMatchObject({
                exitCode: 2,
            });
        expect(installManagerService).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(root, "missing"))).toBe(false);
    });
    it("EACCES不是缺失，不吞异常继续向上创建候选", async () => {
        const root = fixture();
        const blocked = path.join(root, "blocked");
        const original = fs.lstatSync;
        vi.spyOn(fs, "lstatSync").mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
            if (args[0] === blocked)
                throw Object.assign(new Error("private-permission-detail"), { code: "EACCES" });
            return original(...args);
        });
        expect(await installManagerServiceCommand({ dataDir: blocked })).toEqual({
            output: "管理服务安装选项或目录无法确认，未执行安装。",
            exitCode: 2,
        });
        expect(installManagerService).not.toHaveBeenCalled();
    });
    it("非法输入不派发，异常和未知结果不泄露spec或原始错误", async () => {
        const root = fixture();
        expect(await installManagerServiceCommand({ dataDir: root, port: 0 })).toMatchObject({
            exitCode: 2,
        });
        expect(
            await installManagerServiceCommand({ dataDir: root, register: ["mock"] } as never),
        ).toMatchObject({ exitCode: 2 });
        expect(installManagerService).not.toHaveBeenCalled();
        vi.mocked(installManagerService).mockImplementation(async spec =>
            record(spec, { status: "interrupted", phase: "writing", recoveryRequired: true }),
        );
        const unknown = await installManagerServiceCommand({ dataDir: root });
        expect(unknown.exitCode).toBe(1);
        expect(unknown.output).toContain("操作 install-test：interrupted（writing）");
        expect(unknown.output).not.toContain(root);
        expect(unknown.output).not.toContain("已安装");
        vi.mocked(installManagerService).mockRejectedValue(new Error("private-secret raw spec"));
        const failed = await installManagerServiceCommand({ dataDir: root });
        expect(failed.exitCode).toBe(1);
        expect(failed.output).not.toContain("private-secret");
    });
});
