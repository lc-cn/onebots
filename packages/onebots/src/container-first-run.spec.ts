import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { getConfiguredPluginSelection } from "./runtime-plugin-selection.js";
import { TerminalWorkspace } from "./tui/workspace.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("首次工作区不生成示例配置，依赖选择只进入内存草稿", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-first-run-"));
    roots.push(root);
    const file = path.join(root, "config.yaml");
    const workspace = new TerminalWorkspace(file, root);
    expect(workspace.summary().accounts).toEqual([]);
    expect(workspace.selection).toEqual({ adapters: [], protocols: [], applications: [] });
    workspace.select({ adapters: ["telegram"], protocols: ["onebot-v11"], applications: [] });
    expect(workspace.summary().accounts).toEqual([]);
    expect(workspace.config.general).toEqual({});
    expect(fs.existsSync(file)).toBe(false);
});
it("旧容器只加载配置实际使用的扩展，不迁移或预填配置", () => {
    const config = {
        general: { "onebot.v11": {} },
        "telegram.mybot": { token: "synthetic", "satori.v1": {} },
    };
    const original = structuredClone(config);
    expect(getConfiguredPluginSelection(config, true)).toEqual({
        adapters: ["telegram"],
        protocols: ["onebot-v11", "satori-v1"],
        applications: [],
    });
    expect(config).toEqual(original);
    expect(getConfiguredPluginSelection(config, false)).toBeUndefined();
    expect(
        getConfiguredPluginSelection({ ...config, plugins: { adapters: [], protocols: [] } }, true),
    ).toEqual({ adapters: [], protocols: [] });
});
