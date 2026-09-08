import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createInstallationPlan } from "./installation.js";
import {
    createDockerRequestBackend,
    readInstallationRequest,
} from "./installation-request.js";
import { runInstallation } from "./tui/onboarding.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("Docker 复用 TUI 全流程，私有凭据与执行选择分开，交接前不宣称安装已完成", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-request-"));
    roots.push(root);
    const answers = [["icqq"], ["synthetic_token"], ["onebot-v11"], ["nonebot"], ["install"]];
    const prompt = { ask: vi.fn(async () => answers.shift()!), report: vi.fn() };
    const backend = createDockerRequestBackend(root);
    const verify = vi.spyOn(backend, "verify");
    const selection = await runInstallation(prompt, root, { adapters: [], protocols: [] }, backend);
    expect(verify).not.toHaveBeenCalled();
    expect(prompt.report).not.toHaveBeenCalledWith(expect.stringContaining("依赖已验证"));
    const request = path.join(root, "request.json");
    expect(fs.readFileSync(request, "utf8")).not.toContain("synthetic_token");
    expect(fs.readFileSync(path.join(root, "npmrc"), "utf8")).toContain("synthetic_token");
    expect(fs.statSync(path.join(root, "npmrc")).mode & 0o777).toBe(0o600);
    expect(readInstallationRequest(request)).toEqual(createInstallationPlan(selection));
    expect(readInstallationRequest(request).peers).toContainEqual(
        expect.stringMatching(/^@icqqjs\/icqq@/),
    );
    expect(fs.existsSync(path.join(root, "config.yaml"))).toBe(false);
});
it("不信任交接文件中的包名或框架组合，按当前目录重新验证", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-request-"));
    roots.push(root);
    const request = path.join(root, "request.json");
    fs.writeFileSync(
        request,
        JSON.stringify({ schemaVersion: 1, selection: { adapters: ["unknown"], protocols: [] } }),
    );
    expect(() => readInstallationRequest(request)).toThrow("安装目录");
    fs.writeFileSync(
        request,
        JSON.stringify({
            schemaVersion: 1,
            selection: { adapters: [], protocols: [], applications: ["nonebot"] },
        }),
    );
    expect(() => readInstallationRequest(request)).toThrow("onebot-v11");
});

it("Docker 私有包缺少凭据时留在安装阶段，不借用长期网关的认证", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-request-"));
    roots.push(root);
    const backend = createDockerRequestBackend(root, ["@onebots/adapter-icqq"]);
    await expect(backend.install([], root, "")).rejects.toThrow("请填写");
    expect(fs.existsSync(path.join(root, "npmrc"))).toBe(false);
    const explicit = createDockerRequestBackend(root, ["@onebots/adapter-icqq"], true);
    await explicit.install([], root, "");
    expect(fs.readFileSync(path.join(root, "npmrc"), "utf8")).toBe("");
});
