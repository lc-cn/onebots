import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { containerServiceAction } from "./container.js";
import { TerminalWorkspace } from "./workspace.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("容器运行管理只提供宿主命令，不把查看状态或重启说明报告为上线成功", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-container-tui-"));
    roots.push(root);
    const workspace = new TerminalWorkspace(path.join(root, "config.yaml"), root);
    const prompt = { ask: vi.fn(async () => ["back"]), report: vi.fn() };
    await containerServiceAction(prompt, workspace, "status");
    await containerServiceAction(prompt, workspace, "stop");
    expect(prompt.ask.mock.calls).toHaveLength(2);
    expect(prompt.report).not.toHaveBeenCalled();
    expect(fs.existsSync(workspace.configPath)).toBe(false);
});
