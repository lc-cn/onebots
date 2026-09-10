import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    bootstrapManagerService,
    type ManagerBootstrapRequest,
} from "../manager-service-bootstrap.js";
import { bundledRuntimeArtifacts } from "../installation/bundled-runtime-artifacts.js";
import { installManagerServiceCommand } from "./manager-service-install-command.js";
import { options as installOptions } from "../commands/install.js";
import type { ManagerServiceSpec } from "../manager-service-spec.js";
import type { ManagerServiceRecord } from "../manager-service-journal.js";
import {
    ManagerBootstrapCandidateError,
    ManagerBootstrapSetupError,
    ManagerBootstrapStageError,
} from "../manager-bootstrap-error.js";

vi.mock("../manager-service-install.js", () => {
    throw new Error("旧 installManagerService 旁路不可由 CLI 导入");
});
vi.mock("../manager-service-bootstrap.js", () => ({ bootstrapManagerService: vi.fn() }));
vi.mock("../installation/bundled-runtime-artifacts.js", () => ({
    bundledRuntimeArtifacts: vi.fn(),
}));
const artifacts = {
    host: { name: "onebots", version: "1.0.0", spec: "1.0.0" },
    core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
};
const roots: string[] = [];
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(bootstrapManagerService).mockReset();
    vi.mocked(bundledRuntimeArtifacts).mockReset();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-install-cli-"));
    roots.push(root);
    vi.mocked(bundledRuntimeArtifacts).mockReturnValue(artifacts);
    vi.mocked(bootstrapManagerService).mockImplementation(async request =>
        record(candidateSpec(request), { id: request.id ?? "initial-install" }),
    );
    return root;
}
function candidateSpec(request: ManagerBootstrapRequest): ManagerServiceSpec {
    return {
        ...request.service,
        workingDirectory: "/verified-candidate",
        binPath: "/verified-candidate/node_modules/onebots/lib/bin.js",
    };
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
        expect(vi.mocked(bootstrapManagerService).mock.calls.at(-1)?.[0].service.workspace).toBe(
            fs.realpathSync(process.cwd()),
        );
        vi.stubEnv("ONEBOTS_WORKSPACE", path.join(root, "from-env"));
        await installManagerServiceCommand({});
        expect(vi.mocked(bootstrapManagerService).mock.calls.at(-1)?.[0].service.workspace).toBe(
            path.join(root, "from-env"),
        );
        await installManagerServiceCommand({ dataDir: path.join(root, "explicit") });
        expect(vi.mocked(bootstrapManagerService).mock.calls.at(-1)?.[0].service.workspace).toBe(
            path.join(root, "explicit"),
        );
        expect(fs.existsSync(path.join(root, "from-env"))).toBe(false);
        expect(fs.existsSync(path.join(root, "explicit"))).toBe(false);
    });
    it("未来目录只读规范化，由 bootstrap 决定候选路径且成功不宣称已运行", async () => {
        const root = fixture();
        const link = path.join(root, "ancestor-link");
        fs.symlinkSync(root, link);
        const future = path.join(link, "not-created", "工作 区");
        const output = await installManagerServiceCommand({ dataDir: future });
        const workspace = path.join(root, "not-created", "工作 区");
        expect(vi.mocked(bootstrapManagerService).mock.calls[0]).toEqual([
            {
                service: {
                    schemaVersion: 1,
                    runtimeKind: "control",
                    scope: "user",
                    workspace,
                    nodePath: process.execPath,
                    host: "127.0.0.1",
                    port: 6727,
                },
            },
            { artifacts },
        ]);
        expect(fs.existsSync(path.join(root, "not-created"))).toBe(false);
        expect(output).toMatchObject({
            exitCode: 0,
            output: expect.stringContaining("管理服务已注册；本命令不会启动服务。"),
        });
        expect(output.output).toContain("操作 initial-install：succeeded（completed）");
        expect(output.output).toContain("onebots auth bootstrap --data-dir '" + workspace + "'");
        expect(output.output).toContain("onebots start\n");
    });
    it("重复 CLI 请求使用同一个稳定安装 ID", async () => {
        const root = fixture();
        await installManagerServiceCommand({ dataDir: root });
        await installManagerServiceCommand({ dataDir: root });
        expect(vi.mocked(bootstrapManagerService).mock.calls.map(call => call[0].id)).toEqual([
            undefined,
            undefined,
        ]);
        expect(vi.mocked(bootstrapManagerService).mock.calls[0]).toEqual(
            vi.mocked(bootstrapManagerService).mock.calls[1],
        );
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
        expect(vi.mocked(bootstrapManagerService).mock.calls[0][0].service).toMatchObject({
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
        expect(bootstrapManagerService).not.toHaveBeenCalled();
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
        expect(bootstrapManagerService).not.toHaveBeenCalled();
    });
    it("非法输入不派发，异常和未知结果不泄露spec或原始错误", async () => {
        const root = fixture();
        expect(await installManagerServiceCommand({ dataDir: root, port: 0 })).toMatchObject({
            exitCode: 2,
        });
        expect(
            await installManagerServiceCommand({ dataDir: root, register: ["mock"] } as never),
        ).toMatchObject({ exitCode: 2 });
        expect(bootstrapManagerService).not.toHaveBeenCalled();
        vi.mocked(bootstrapManagerService).mockImplementation(async request =>
            record(candidateSpec(request), {
                id: request.id ?? "initial-install",
                status: "interrupted",
                phase: "writing",
                recoveryRequired: true,
            }),
        );
        const unknown = await installManagerServiceCommand({ dataDir: root });
        expect(unknown.exitCode).toBe(1);
        expect(unknown.output).toContain("操作 initial-install：interrupted（writing）");
        expect(unknown.output).toContain("onebots recover --operation initial-install");
        expect(unknown.output).not.toContain(root);
        expect(unknown.output).not.toContain("已安装");
        vi.mocked(bootstrapManagerService).mockRejectedValue(new Error("private-secret raw spec"));
        const failed = await installManagerServiceCommand({ dataDir: root });
        expect(failed.exitCode).toBe(1);
        expect(failed.output).not.toContain("private-secret");

        vi.mocked(bootstrapManagerService).mockRejectedValue(
            new ManagerBootstrapSetupError("service-lock", "SERVICE_LOCK_FAILED"),
        );
        const setup = await installManagerServiceCommand({ dataDir: root });
        expect(setup).toEqual({
            exitCode: 1,
            output:
                "管理服务首次安装失败：operationId=unavailable，bootstrapPhase=service-lock，code=SERVICE_LOCK_FAILED。\n" +
                "未下载候选或派发系统服务注册；请修复对应的本机前置条件后重试。",
        });

        vi.mocked(bootstrapManagerService).mockRejectedValue(
            new ManagerBootstrapCandidateError(
                "candidate-install",
                "failed",
                "VERIFICATION_FAILED",
            ),
        );
        const candidate = await installManagerServiceCommand({ dataDir: root });
        expect(candidate).toEqual({
            exitCode: 1,
            output:
                "管理服务首次安装失败：operationId=candidate-install，bootstrapPhase=candidate-failed，code=VERIFICATION_FAILED。\n" +
                "尚未派发系统服务注册；请保留 manager-artifacts 中的原操作和候选证据。",
        });

        vi.mocked(bootstrapManagerService).mockRejectedValue(
            new ManagerBootstrapStageError(
                "candidate-install",
                "manager-prepared",
                "MANAGER_JOURNAL_FAILED",
            ),
        );
        const manager = await installManagerServiceCommand({ dataDir: root });
        expect(manager).toEqual({
            exitCode: 1,
            output:
                "管理服务首次安装失败：operationId=candidate-install，bootstrapPhase=manager-prepared，code=MANAGER_JOURNAL_FAILED。\n" +
                "未重派下载或系统动作；请保留原操作和本机持久证据。",
        });
    });
});
