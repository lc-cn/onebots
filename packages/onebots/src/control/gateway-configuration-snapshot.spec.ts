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
it("非普通文件条目拒绝新增，不删除未知存储", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, {});
    const unknown = path.join(path.dirname(first.configPath), "reserved-directory");
    fs.mkdirSync(unknown);
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "debug" })).toThrow(
        /^网关快照存储无效$/,
    );
    expect(fs.statSync(unknown).isDirectory()).toBe(true);
    expect(createGatewayConfigurationSnapshot(root, {})).toEqual(first);
});
it.skipIf(process.platform === "win32")("符号链接条目拒绝新增，不追踪或删除目标", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, {});
    const unknown = path.join(path.dirname(first.configPath), "reserved-link");
    fs.symlinkSync(first.configPath, unknown);
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "debug" })).toThrow(
        /^网关快照存储无效$/,
    );
    expect(fs.lstatSync(unknown).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(first.configPath)).toBe(true);
});
it("EEXIST 竞争只复用校验一致的最终文件并清理 staging", () => {
    const root = workspace();
    vi.spyOn(fs, "renameSync").mockImplementationOnce((source, destination) => {
        fs.copyFileSync(source, destination);
        throw Object.assign(new Error("已有发布文件"), { code: "EEXIST" });
    });
    const result = createGatewayConfigurationSnapshot(root, {});
    expect(fs.readFileSync(result.configPath, "utf8")).toBe(yaml.dump({}));
    expect(fs.readdirSync(path.dirname(result.configPath))).toEqual([
        `${result.configVersion}.yaml`,
    ]);
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
it("单个快照超过 8 MiB 时不发布文件", () => {
    const root = workspace();
    expect(() =>
        createGatewayConfigurationSnapshot(root, { value: "x".repeat(8 * 1024 * 1024) }),
    ).toThrow(/^网关快照超过大小限制$/);
    expect(fs.existsSync(path.join(root, ".control/configurations"))).toBe(false);
});
it("总容量超过 64 MiB 时保留旧快照并拒绝新增", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, {});
    const filler = path.join(path.dirname(first.configPath), "reserved-capacity");
    const descriptor = fs.openSync(filler, "wx", 0o600);
    try {
        fs.ftruncateSync(descriptor, 64 * 1024 * 1024);
    } finally {
        fs.closeSync(descriptor);
    }
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "debug" })).toThrow(
        /容量限制/,
    );
    expect(fs.statSync(filler).size).toBe(64 * 1024 * 1024);
    expect(createGatewayConfigurationSnapshot(root, {})).toEqual(first);
});
it("冷中断的未发布临时文件被回收，已发布版本不删除", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, {});
    const directory = path.dirname(first.configPath);
    const temporary = path.join(directory, ".snapshot-12345678-1234-4234-8234-123456789abc");
    fs.writeFileSync(temporary, "incomplete", { mode: 0o600 });
    const next = createGatewayConfigurationSnapshot(root, { log_level: "debug" });
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.existsSync(first.configPath)).toBe(true);
    expect(fs.existsSync(next.configPath)).toBe(true);
});
it("临时路径的硬链接不能作为孤儿文件自动删除", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, {});
    const temporary = path.join(
        path.dirname(first.configPath),
        ".snapshot-12345678-1234-4234-8234-123456789abc",
    );
    fs.linkSync(first.configPath, temporary);
    expect(() => createGatewayConfigurationSnapshot(root, { log_level: "debug" })).toThrow(
        /^网关快照存储无效$/,
    );
    expect(fs.existsSync(temporary)).toBe(true);
    expect(fs.existsSync(first.configPath)).toBe(true);
});
it("未知 staging 名称不被自动认领或删除", () => {
    const root = workspace();
    const first = createGatewayConfigurationSnapshot(root, {});
    const unknown = path.join(path.dirname(first.configPath), ".snapshot-interrupted");
    fs.writeFileSync(unknown, "unknown", { mode: 0o600 });
    createGatewayConfigurationSnapshot(root, { log_level: "debug" });
    expect(fs.readFileSync(unknown, "utf8")).toBe("unknown");
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
