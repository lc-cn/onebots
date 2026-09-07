import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalWorkspace, nextWorkspaceStep } from "./workspace.js";
const directories: string[] = [];
afterEach(() => {
    for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(content?: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-workspace-test-"));
    directories.push(root);
    const file = path.join(root, "config.yaml");
    if (content) fs.writeFileSync(file, content);
    return new TerminalWorkspace(file, root);
}
describe("终端工作区事务", () => {
    it("修改、页面摘要和配置共享草稿，只在提交时写入并备份", () => {
        const original = "port: 6727\naccess_token: preserved-secret\n";
        const workspace = fixture(original);
        const draft = workspace.config;
        draft.port = 7777;
        workspace.update(draft);
        draft.port = 8888;
        expect(workspace.config.port).toBe(7777);
        expect(fs.readFileSync(workspace.configPath, "utf8")).toBe(original);
        expect(workspace.summary().changes).toEqual(["port"]);
        expect(JSON.stringify(workspace.summary())).not.toContain("preserved-secret");
        workspace.commit();
        expect(workspace.dirty).toBe(false);
        expect(workspace.needsRestart).toBe(true);
        expect(fs.readFileSync(workspace.configPath + ".bak", "utf8")).toBe(original);
        if (process.platform !== "win32")
            expect(fs.statSync(workspace.configPath).mode & 0o777).toBe(0o600);
    });
    it("外部修改不覆盖草稿，提交也不会覆盖外部文件", () => {
        const workspace = fixture("port: 6727\n");
        workspace.update({ ...workspace.config, port: 7777 });
        fs.writeFileSync(workspace.configPath, "port: 8888\n");
        workspace.sync();
        expect(workspace.summary().conflict).toBe(true);
        expect(workspace.config.port).toBe(7777);
        expect(() => workspace.commit()).toThrow("其他操作更新");
        workspace.reload();
        expect(workspace.config.port).toBe(8888);
        expect(workspace.dirty).toBe(false);
    });
    it("损坏配置仍能进入工作台，通过备份恢复后才能保存", () => {
        const workspace = fixture("invalid: [");
        expect(nextWorkspaceStep(workspace.summary()).page).toBe("settings");
        expect(() => workspace.commit()).toThrow("无法读取");
        fs.writeFileSync(workspace.configPath + ".bak", "port: 7777\n");
        workspace.restoreBackup();
        expect(workspace.config.port).toBe(7777);
        expect(fs.readFileSync(workspace.configPath, "utf8")).toBe("invalid: [");
        workspace.commit();
        expect(workspace.summary().error).toBeUndefined();
    });
    it("宿主切换保留草稿，并检测切换期间的磁盘冲突", () => {
        const workspace = fixture("port: 6727\n");
        workspace.update({ ...workspace.config, port: 7777 });
        const next = new TerminalWorkspace(workspace.configPath, workspace.root);
        next.resume(workspace.snapshot());
        expect(next.config.port).toBe(7777);
        expect(next.dirty).toBe(true);
        fs.writeFileSync(workspace.configPath, "port: 8888\n");
        const changed = new TerminalWorkspace(workspace.configPath, workspace.root);
        changed.resume(workspace.snapshot());
        expect(changed.summary().conflict).toBe(true);
    });
});
