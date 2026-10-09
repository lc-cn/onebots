import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { createGatewayConfigurationSnapshot } from "./gateway-configuration-snapshot.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function workspace() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-snapshot-review-")));
    roots.push(root);
    return root;
}
it("发布完整快照并移除管理凭据，重复读取保持原文件", () => {
    const root = workspace();
    const document = {
        username: "private",
        password: "private",
        access_token: "private",
        "mock.bot": { "onebot.v11": { access_token: "protocol-token" } },
    };
    const first = createGatewayConfigurationSnapshot(root, document);
    const bytes = fs.readFileSync(first.configPath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(first.configVersion);
    expect(yaml.load(bytes.toString())).toEqual({
        "mock.bot": { "onebot.v11": { access_token: "protocol-token" } },
    });
    expect(createGatewayConfigurationSnapshot(root, document)).toEqual(first);
    expect(fs.readdirSync(path.dirname(first.configPath))).toEqual([`${first.configVersion}.yaml`]);
    expect(fs.statSync(first.configPath).nlink).toBe(1);
});
it("发布失败不留下最终摘要路径或临时文件，后续可重试", () => {
    const root = workspace();
    const publish = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw new Error("发布失败");
    });
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "off" })).toThrow(
        "发布失败",
    );
    expect(fs.readdirSync(path.join(root, ".control/configurations"))).toEqual([]);
    publish.mockRestore();
    expect(
        fs.existsSync(createGatewayConfigurationSnapshot(root, { log_level: "off" }).configPath),
    ).toBe(true);
});
it("已存在但截断的快照不被悄悄覆盖", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, { log_level: "off" });
    fs.writeFileSync(first.configPath, "truncated");
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "off" })).toThrow(
        "网关快照校验失败",
    );
    expect(fs.readFileSync(first.configPath, "utf8")).toBe("truncated");
});
it("容量边界拒绝新增，不删除旧快照或损坏已有版本", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, { log_level: "off" });
    const directory = path.dirname(first.configPath);
    for (let index = 1; index < 512; index++)
        fs.writeFileSync(path.join(directory, `reserved-${index}`), "", { mode: 0o600 });
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "debug" })).toThrow(
        "容量限制",
    );
    expect(createGatewayConfigurationSnapshot(root, { log_level: "off" })).toEqual(first);
    expect(fs.readdirSync(directory)).toHaveLength(512);
});
it("启动时清理崩溃遗留的 staging，再计算容量", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, { log_level: "off" });
    const directory = path.dirname(first.configPath);
    fs.writeFileSync(path.join(directory, ".snapshot-interrupted"), "partial", { mode: 0o600 });
    createGatewayConfigurationSnapshot(root, { log_level: "debug" });
    expect(fs.readdirSync(directory).some(name => name.startsWith(".snapshot-"))).toBe(false);
});
it("拒绝单个超过 8 MiB 的快照", () => {
    const root = workspace();
    expect(() =>
        createGatewayConfigurationSnapshot(root, { payload: "x".repeat(8 * 1024 * 1024) }),
    ).toThrow("网关快照超过大小限制");
});
it("拒绝总量超过 64 MiB 的快照存储", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, { log_level: "off" });
    const filler = path.join(path.dirname(first.configPath), "reserved-large");
    fs.writeFileSync(filler, "", { mode: 0o600 });
    fs.truncateSync(filler, 64 * 1024 * 1024);
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "debug" })).toThrow(
        "容量限制",
    );
});
it.skipIf(process.platform === "win32")("既有公开目录不能靠新文件的 0600 掩盖权限风险", () => {
    const root = workspace();
    const directory = path.join(root, ".control/configurations");
    fs.mkdirSync(directory, { recursive: true });
    fs.chmodSync(directory, 0o755);
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "off" })).toThrow(
        "目录权限无效",
    );
    expect(fs.readdirSync(directory)).toEqual([]);
});
