import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { GenerationConfigurationVerifier } from "./generation-configuration.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import { allocateConfigurationVerification } from "../configuration/configuration-verify-ownership.js";
import type { verifyConfiguration } from "../configuration/configuration-verify.js";
vi.mock("../installation/generation-runtime.js", () => ({ resolveGenerationRuntime: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync("/tmp/ob-generation-config-");
    roots.push(root);
    const file = path.join(root, "config.yaml");
    fs.writeFileSync(file, "plugins:\n  adapters: []\n  protocols: []\n  applications: []\n");
    const generation = {
        id: "candidate",
        directory: path.join(root, "candidate"),
        operationId: "install",
        planDigest: "a".repeat(64),
        receipt: {},
    } as VerifiedGeneration;
    let current = generation;
    vi.mocked(resolveGenerationRuntime).mockImplementation((target, selection) => ({
        runtimeRoot: target.directory,
        entrypoint: `${target.directory}/entry.js`,
        dependencyVersion: target.id,
        selection,
    }));
    const verify = vi.fn<typeof verifyConfiguration>(async () => ({ valid: true, issues: [] }));
    const bundledRuntimeRoot = path.join(root, "bundled-runtime");
    const service = new GenerationConfigurationVerifier(
        root,
        () => current,
        verify,
        bundledRuntimeRoot,
    );
    return {
        root,
        file,
        generation,
        verify,
        service,
        bundledRuntimeRoot,
        replace: () => {
            current = { ...generation, planDigest: "b".repeat(64) };
        },
    };
}
it("验证候选宿主及当前配置，返回切换前复核能力", async () => {
    const f = fixture();
    const check = await f.service.verify(f.generation);
    expect(f.verify).toHaveBeenCalledWith(
        expect.objectContaining({
            runtimeRoot: f.generation.directory,
            privateRoot: path.join(f.root, ".control/activation-verification-workers"),
        }),
    );
    expect(check).not.toThrow();
    fs.appendFileSync(f.file, "# external edit\n");
    expect(check).toThrow("配置已变化");
    await f.service.close();
});
it("验证过程中配置变动不能产生有效复核能力", async () => {
    const f = fixture();
    f.verify.mockImplementation(async () => {
        fs.appendFileSync(f.file, "# changed\n");
        return { valid: true, issues: [] };
    });
    await expect(f.service.verify(f.generation)).rejects.toThrow("配置已变化");
});
it("候选收据变化、业务配置不兼容、损坏配置均拒绝", async () => {
    const f = fixture();
    const check = await f.service.verify(f.generation);
    f.replace();
    expect(check).toThrow("候选版本验证记录已变化");
    const incompatible = fixture();
    incompatible.verify.mockResolvedValue({ valid: false, issues: [] });
    await expect(incompatible.service.verify(incompatible.generation)).rejects.toThrow("不兼容");
    const damaged = fixture();
    fs.writeFileSync(damaged.file, "secret: [\n");
    await expect(damaged.service.verify(damaged.generation)).rejects.toThrow("无法读取或解析");
    expect(damaged.verify).not.toHaveBeenCalled();
});
it("候选缺少已配置扩展时不启动验证器", async () => {
    const f = fixture();
    vi.mocked(resolveGenerationRuntime).mockImplementation(() => {
        throw new Error("扩展不在候选版本内");
    });
    await expect(f.service.verify(f.generation)).rejects.toThrow("扩展不在候选");
    expect(f.verify).not.toHaveBeenCalled();
});
it("关闭撤销已签发复核能力并拒绝新验证", async () => {
    const f = fixture();
    const check = await f.service.verify(f.generation);
    await f.service.close();
    expect(check).toThrow("已关闭");
    await expect(f.service.verify(f.generation)).rejects.toThrow("已关闭");
});

it("升级确认的配置摘要在验证开始前必须仍匹配", async () => {
    const f = fixture();
    await expect(f.service.verify(f.generation, "f".repeat(64))).rejects.toThrow("配置已发生变化");
    expect(f.verify).not.toHaveBeenCalled();
});

it("内置运行时影响规划固定使用管理宿主选择的包根并设置显式超时", async () => {
    const f = fixture();
    f.verify.mockResolvedValue({
        valid: true,
        issues: [],
        impact: {
            mode: "none",
            accounts: [],
            protocols: [],
            dynamicFields: [],
            restartReasons: [],
        },
    });
    await f.service.planImpact(null, {}, {});
    expect(f.verify).toHaveBeenCalledWith(
        expect.objectContaining({
            runtimeRoot: f.bundledRuntimeRoot,
            timeoutMs: 15_000,
        }),
    );
});

it("影响规划先恢复自己的 worker 目录，归属不明时拒绝启动新进程", async () => {
    const f = fixture();
    const privateRoot = path.join(f.root, ".control/application-verification-workers");
    allocateConfigurationVerification(privateRoot);
    await expect(f.service.planImpact(null, {}, {})).rejects.toThrow("归属尚待核实");
    expect(f.verify).not.toHaveBeenCalled();
});

it("移除唯一自定义协议仍载入before注册，平台不会被误判重连", async () => {
    const f = fixture();
    const impact = {
        mode: "hot" as const,
        accounts: [],
        protocols: [],
        dynamicFields: [],
        restartReasons: [],
    };
    f.verify.mockResolvedValue({ valid: true, issues: [], impact });
    await f.service.planImpact(null, { "mock.bot": { "custom.v1": {} } }, { "mock.bot": {} });
    expect(f.verify).toHaveBeenCalledWith(
        expect.objectContaining({
            selection: { adapters: ["mock"], protocols: ["custom-v1"], applications: [] },
        }),
    );
});

it("损坏基线的plugins不阻止有效候选进入隔离repair规划", async () => {
    const f = fixture();
    const impact = {
        mode: "restart" as const,
        accounts: [],
        protocols: [],
        dynamicFields: [],
        restartReasons: ["invalid-configuration-baseline"],
    };
    f.verify.mockResolvedValue({ valid: true, issues: [], impact });
    expect(await f.service.planImpact(null, { plugins: false }, { "mock.bot": {} })).toEqual(
        impact,
    );
    expect(f.verify).toHaveBeenCalledWith(
        expect.objectContaining({
            selection: { adapters: ["mock"], protocols: [], applications: [] },
        }),
    );
});

it("当前宿主登记的并发 worker 不当成冷恢复孤儿阻断第二次规划", async () => {
    const f = fixture();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
        release = resolve;
    });
    const impact = {
        mode: "none" as const,
        accounts: [],
        protocols: [],
        dynamicFields: [],
        restartReasons: [],
    };
    f.verify.mockImplementation(async input => {
        if (f.verify.mock.calls.length === 1) allocateConfigurationVerification(input.privateRoot);
        await waiting;
        return { valid: true, issues: [], impact };
    });
    const first = f.service.planImpact(null, {}, {});
    const second = f.service.planImpact(null, {}, {});
    expect(f.verify).toHaveBeenCalledTimes(2);
    release();
    expect(await Promise.all([first, second])).toEqual([impact, impact]);
    await f.service.close();
});

it("权威规划沿用明确的运行根且明确限制规划时间", async () => {
    const root = fs.mkdtempSync("/tmp/ob-impact-bound-");
    roots.push(root);
    const impact = {
        mode: "none" as const,
        accounts: [],
        protocols: [],
        dynamicFields: [],
        restartReasons: [],
    };
    const verify = vi.fn(async () => ({ valid: true, issues: [], impact }));
    const runtimeRoot = path.join(root, "installed-host");
    const service = new GenerationConfigurationVerifier(
        root,
        () => {
            throw new Error("unexpected generation");
        },
        verify,
        runtimeRoot,
    );
    expect(await service.planImpact(null, {}, {})).toEqual(impact);
    expect(verify).toHaveBeenCalledWith(
        expect.objectContaining({
            runtimeRoot,
            timeoutMs: 15_000,
            privateRoot: path.join(root, ".control/application-verification-workers"),
            previousDocument: {},
        }),
    );
    await service.close();
});

it.skipIf(process.platform === "win32")(
    "冷恢复不能遗漏应用规划 worker，未知归属保持请求并阻止新验证",
    async () => {
        const root = fs.mkdtempSync("/tmp/ob-impact-recovery-");
        roots.push(root);
        const privateRoot = path.join(root, ".control/application-verification-workers");
        const { directory } = allocateConfigurationVerification(privateRoot);
        // 活着的旧父进程不是静止证据；不得删除请求或擅自杀任何历史 PID。
        fs.writeFileSync(path.join(directory, "request.json"), "private-test-request", {
            mode: 0o600,
        });
        const verify = vi.fn(async () => ({ valid: true, issues: [] }));
        const service = new GenerationConfigurationVerifier(
            root,
            () => {
                throw new Error("unexpected generation");
            },
            verify,
        );
        await expect(service.planImpact(null, {}, {})).rejects.toThrow("归属尚待核实");
        expect(verify).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(directory, "request.json"), "utf8")).toBe(
            "private-test-request",
        );
        await service.close();
    },
);
