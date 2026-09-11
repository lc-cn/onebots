import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureServiceMigration } from "./service-migration-capture.js";
import { renderSystemdUnit, renderLaunchdPlist, type ServiceSpec } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatformState } from "./service-platform.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(
    platform: "linux" | "darwin" = "linux",
    content = "password: private-secret\r\ngeneral: {}\r\n",
) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/onebots-capture-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    const config = path.join(workspace, "custom.yaml");
    fs.writeFileSync(config, content, { mode: 0o600 });
    const host: ServiceHost = {
        platform,
        homedir: path.join(root, "home"),
        uid: 1000,
        env: {},
        exec: vi.fn(() => {
            throw new Error("不得调用OS命令");
        }),
        spawn: vi.fn(async () => {
            throw new Error("不得启动进程");
        }),
    };
    const legacy: ServiceSpec = {
        scope: "user",
        configPath: config,
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        workingDirectory: workspace,
    };
    const target: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        workingDirectory: workspace,
        host: "127.0.0.1",
        port: 6727,
    };
    const paths = getServiceFiles("user", host);
    fs.mkdirSync(paths.stateDir, { recursive: true });
    fs.mkdirSync(path.dirname(paths.definition), { recursive: true });
    const writeLegacy = (spec = legacy) => {
        fs.writeFileSync(paths.metadata, JSON.stringify(spec) + "\n", { mode: 0o600 });
        fs.writeFileSync(
            paths.definition,
            platform === "linux"
                ? renderSystemdUnit(spec)
                : renderLaunchdPlist(
                      spec,
                      path.join(paths.stateDir, "onebots.log"),
                      path.join(paths.stateDir, "onebots-error.log"),
                  ),
            { mode: 0o644 },
        );
    };
    writeLegacy();
    const state: ServicePlatformState = {
        state: "running",
        running: true,
        enabled: true,
        loaded: true,
        definitionPath: paths.definition,
        processId: 12,
        identity: "a".repeat(32),
        quiescent: false,
    };
    const inspect = vi.fn(async (): Promise<ServicePlatformState> => ({ ...state }));
    const capture = () => captureServiceMigration(target, host, { inspect });
    const bytes = () =>
        [paths.definition, paths.metadata, config].map(file => ({
            file,
            bytes: fs.readFileSync(file),
            mode: fs.statSync(file).mode,
        }));
    return {
        root,
        workspace,
        config,
        paths,
        host,
        legacy,
        target,
        state,
        inspect,
        capture,
        bytes,
        writeLegacy,
    };
}

describe("服务迁移只读一致性捕获", () => {
    it.each(["linux", "darwin"] as const)(
        "%s运行来源保留原字节和权限，不创建目标配置或控制目录",
        async platform => {
            const f = fixture(platform);
            const before = f.bytes();
            const result = await f.capture();
            expect(result.previousRunning).toBe(true);
            expect(result.previousEnabled).toBe(true);
            expect(result.target).toEqual(f.target);
            expect(result.files).toHaveLength(3);
            for (const entry of result.files) {
                const source = before.find(file => file.file === entry.path)!;
                expect(Buffer.from(entry.contentBase64, "base64")).toEqual(source.bytes);
                expect(entry.mode).toBe(source.mode & 0o777);
            }
            expect(f.bytes()).toEqual(before);
            expect(fs.existsSync(path.join(f.workspace, "config.yaml"))).toBe(false);
            expect(fs.existsSync(path.join(f.workspace, ".control"))).toBe(false);
            expect(f.host.exec).not.toHaveBeenCalled();
            expect(f.host.spawn).not.toHaveBeenCalled();
        },
    );
    it("正常停止与未启用分别保留，不推断重启意图", async () => {
        const f = fixture();
        Object.assign(f.state, {
            state: "stopped",
            running: false,
            enabled: false,
            processId: null,
            identity: null,
            quiescent: true,
        });
        expect(await f.capture()).toMatchObject({ previousRunning: false, previousEnabled: false });
    });
    it.each(["failed", "transitioning"] as const)(
        "%s来源即使零PID且quiescent也不能当正常停止",
        async state => {
            const f = fixture();
            Object.assign(f.state, {
                state,
                running: false,
                processId: null,
                identity: null,
                quiescent: true,
            });
            const before = f.bytes();
            await expect(f.capture()).rejects.toThrow("旧系统服务无法安全捕获");
            expect(f.bytes()).toEqual(before);
        },
    );
    it("进程PID或Invocation身份在两次观测间变化则拒绝", async () => {
        for (const patch of [{ processId: 13 }, { identity: "b".repeat(32) }, { enabled: false }]) {
            const f = fixture();
            f.inspect
                .mockResolvedValueOnce({ ...f.state })
                .mockResolvedValueOnce({ ...f.state, ...patch });
            const before = f.bytes();
            await expect(f.capture()).rejects.toThrow("旧系统服务无法安全捕获");
            expect(f.bytes()).toEqual(before);
        }
    });
    it("第一次平台观测期间元数据与定义一起换版也不能混入旧捕获", async () => {
        const f = fixture();
        f.inspect.mockImplementationOnce(async () => {
            f.writeLegacy({ ...f.legacy, adapters: ["mock"] });
            return { ...f.state };
        });
        await expect(f.capture()).rejects.toThrow("旧系统服务无法安全捕获");
        expect(JSON.parse(fs.readFileSync(f.paths.metadata, "utf8")).adapters).toEqual(["mock"]);
    });
    it("第一次平台观测期间配置漂移也必须拒绝，不混用旧进程和新磁盘配置", async () => {
        const f = fixture();
        f.inspect.mockImplementationOnce(async () => {
            fs.writeFileSync(f.config, "general: {}\nplugins:\n  adapters: [mock]\n");
            return { ...f.state };
        });
        await expect(f.capture()).rejects.toThrow("旧系统服务无法安全捕获");
        expect(fs.readFileSync(f.config, "utf8")).toContain("adapters: [mock]");
    });
    it.each(["metadata", "definition", "configuration", "mode"])(
        "第二次平台观测期间%s漂移拒绝且不回滚外部修改",
        async role => {
            const f = fixture();
            f.inspect.mockResolvedValueOnce({ ...f.state }).mockImplementationOnce(async () => {
                if (role === "mode") fs.chmodSync(f.config, 0o640);
                else
                    fs.appendFileSync(
                        role === "metadata"
                            ? f.paths.metadata
                            : role === "definition"
                              ? f.paths.definition
                              : f.config,
                        "\n# externally changed\n",
                    );
                return { ...f.state };
            });
            await expect(f.capture()).rejects.toThrow("旧系统服务无法安全捕获");
            if (role === "mode") expect(fs.statSync(f.config).mode & 0o777).toBe(0o640);
            else
                expect(
                    fs.readFileSync(
                        role === "metadata"
                            ? f.paths.metadata
                            : role === "definition"
                              ? f.paths.definition
                              : f.config,
                        "utf8",
                    ),
                ).toContain("externally changed");
        },
    );
    it("损坏配置原样捕获，不默认为空也不输出原始错误秘密", async () => {
        const f = fixture("linux", 'password: "private-secret\r\n');
        const bytes = fs.readFileSync(f.config);
        const backup = await f.capture();
        expect(
            Buffer.from(
                backup.files.find(file => file.role === "configuration")!.contentBase64,
                "base64",
            ),
        ).toEqual(bytes);
        f.inspect.mockRejectedValue(new Error("private-secret OS details"));
        await expect(f.capture()).rejects.toThrow(
            /^旧系统服务无法安全捕获，请检查定义、配置与实际进程状态$/,
        );
        expect(fs.readFileSync(f.config)).toEqual(bytes);
    });
    it("非原位定义及含残留子树的停止状态都拒绝", async () => {
        for (const patch of [
            { definitionPath: "/tmp/other.service" },
            {
                state: "stopped" as const,
                running: false,
                quiescent: false,
                processId: null,
                identity: null,
            },
        ]) {
            const f = fixture();
            Object.assign(f.state, patch);
            await expect(f.capture()).rejects.toThrow("旧系统服务无法安全捕获");
        }
    });
});
