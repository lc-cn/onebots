import { expect, it, vi } from "vitest";
import { ControlClient, type ControlTransport } from "./control.js";

it("升级检查只提交运行版本与配置基线，不安装、不激活或传递下载授权", async () => {
    const base = { generationId: null, configRevision: "a".repeat(64) };
    const result = { state: "current", base, packages: [], peers: [], recommendations: [] };
    const request = vi.fn<ControlTransport["request"]>(async <T>() => result as T);
    await expect(new ControlClient({ request }).planUpdate(base)).resolves.toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/control/updates/plan", {
        expected: base,
    });
});
