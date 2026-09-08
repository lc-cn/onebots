import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { GenerationConfigurationVerifier } from "./generation-configuration.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
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
    const verify = vi.fn(async () => ({ valid: true, issues: [] }));
    const service = new GenerationConfigurationVerifier(root, () => current, verify);
    return {
        root,
        file,
        generation,
        verify,
        service,
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
