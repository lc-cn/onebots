import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    configureAccounts,
    configureRuntime,
    editSchema,
    readConfiguration,
} from "./configuration.js";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import { TuiCancelled, type TuiPrompt, type PromptRequest } from "./prompt.js";

const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-tui-config-"));
    directories.push(directory);
    return path.join(directory, "config.yaml");
}

function promptFor(answers: string[][], inspect?: (request: PromptRequest) => void): TuiPrompt {
    return {
        report: vi.fn(),
        ask: vi.fn(async request => {
            inspect?.(request);
            const answer = answers.shift();
            if (!answer) throw new TuiCancelled();
            return answer;
        }),
    };
}

describe("TUI Schema 配置", () => {
    it("创建账号时明确选择协议，空选择会重试，然后保存两类独立凭据", async () => {
        vi.spyOn(AdapterRegistry, "getSchema").mockReturnValue({
            account_id: { type: "string", required: true },
            token: { type: "string", required: true, sensitive: true },
        });
        vi.spyOn(ProtocolRegistry, "getSchema").mockReturnValue({
            http: { type: "boolean", default: true },
            access_token: { type: "string", sensitive: true },
        });
        const config = {};
        const prompt = promptFor([
            ["add:telegram"],
            ["bot"],
            ["platform-secret"],
            [],
            ["onebot-v11"],
            ["keep"],
            ["protocol-secret"],
            ["done"],
        ]);
        await configureAccounts(prompt, config, {
            adapters: ["telegram"],
            protocols: ["onebot-v11"],
        });
        expect(config).toEqual({
            "telegram.bot": {
                token: "platform-secret",
                "onebot.v11": { http: true, access_token: "protocol-secret" },
            },
        });
        expect(prompt.report).toHaveBeenCalledWith(expect.stringContaining("至少需要一个协议"));
    });
    it("保留隐藏的已有凭据，并按依赖字段显示表单", async () => {
        const requests: PromptRequest[] = [];
        const result = await editSchema(
            promptFor([[""], ["1"], ["8080"]], request => requests.push(request)),
            {
                token: { type: "string", sensitive: true, required: true },
                mode: {
                    type: "string",
                    choices: [
                        { label: "轮询", value: "polling" },
                        { label: "回调", value: "webhook" },
                    ],
                },
                port: { type: "number", ui: { visibleWhen: { path: "mode", oneOf: ["webhook"] } } },
            },
            { token: "existing-secret", mode: "polling" },
            "test",
        );
        expect(result).toEqual({ token: "existing-secret", mode: "webhook", port: 8080 });
        expect(JSON.stringify(requests)).not.toContain("existing-secret");
        expect(requests[0]).toMatchObject({ secret: true, initial: "" });
    });

    it("无效字段可以修正，敏感内容不出现在错误提示中", async () => {
        const prompt = promptFor([["bad-secret"], ["good-secret"]]);
        const result = await editSchema(
            prompt,
            { token: { type: "string", sensitive: true, pattern: /^good-/ } },
            {},
            "test",
        );
        expect(result.token).toBe("good-secret");
        expect(JSON.stringify(vi.mocked(prompt.report).mock.calls)).not.toContain("bad-secret");
    });

    it("取消保存不创建配置，保存会保留已有字段并备份", async () => {
        const file = fixture();
        await expect(
            configureRuntime(promptFor([["no"], ["done"], ["no"]]), file, {
                adapters: [],
                protocols: [],
            }),
        ).resolves.toBe(false);
        expect(fs.existsSync(file)).toBe(false);
        const original = "port: 6727\nlog_level: debug\naccess_token: preserved-secret\n";
        fs.writeFileSync(file, original, { mode: 0o600 });
        await expect(
            configureRuntime(promptFor([["no"], ["done"], ["yes"]]), file, {
                adapters: [],
                protocols: [],
                applications: [],
            }),
        ).resolves.toBe(true);
        expect(readConfiguration(file)).toMatchObject({
            access_token: "preserved-secret",
            log_level: "debug",
            plugins: { adapters: [], protocols: [], applications: [] },
        });
        expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(original);
        if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it("并发修改不会被向导覆盖", async () => {
        const file = fixture();
        fs.writeFileSync(file, "port: 6727\naccess_token: secret\n", { mode: 0o600 });
        const prompt = promptFor([["no"], ["done"], ["yes"]], request => {
            if (request.title === "保存配置？") fs.writeFileSync(file, "port: 7777\n");
        });
        await expect(
            configureRuntime(prompt, file, { adapters: [], protocols: [] }),
        ).rejects.toThrow("其他操作修改");
        expect(fs.readFileSync(file, "utf8")).toBe("port: 7777\n");
    });
});
