import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ControlClient } from "@onebots/core/control";
import { runConfigurationCommand } from "./configuration-command.js";
const uuid = "12345678-1234-1234-1234-123456789abc";
const hash = "a".repeat(64);
function fixture() {
    const calls: Array<{ method: string; route: string; body: unknown }> = [];
    const request = vi.fn(
        async <T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> => {
            calls.push({ method, route, body });
            return {
                base: { generationId: null, configRevision: hash },
                document: {},
                secretStates: [],
            } as T;
        },
    );
    const output = vi.fn();
    const client = new ControlClient({ request });
    const run = (args: string[], input = "", tty = false) => {
        const stdin = Object.assign(Readable.from([input]), { isTTY: tty });
        return runConfigurationCommand(args, { createClient: () => client, stdin, output });
    };
    return { calls, request, output, run };
}
describe("配置 CLI", () => {
    it("source/context只读取，repair要求stdin显式new-empty策略和基线", async () => {
        const { run, calls } = fixture();
        await run(["source"]);
        await run(["context", "--draft", uuid]);
        const base = { generationId: null, configRevision: hash };
        await run(["repair", "--stdin"], JSON.stringify({ base, strategy: "new-empty" }));
        expect(calls.map(call => call.route)).toEqual([
            "/api/control/configuration/source",
            `/api/control/configuration/drafts/${uuid}/context`,
            "/api/control/configuration/repair-drafts",
        ]);
        expect(calls[2].body).toEqual({ base, strategy: "new-empty" });
        for (const value of [
            { base },
            { base, strategy: "guess-old" },
            { base, strategy: "new-empty", raw: "private-yaml" },
        ])
            await expect(run(["repair", "--stdin"], JSON.stringify(value))).rejects.toThrow();
        await expect(
            run(["repair", "--stdin"], JSON.stringify({ base, strategy: "new-empty" }), true),
        ).rejects.toThrow();
        expect(calls).toHaveLength(3);
    });
    it("账号删除和协议启停原样派发，不猜协议名或补默认", async () => {
        const { run, calls, output } = fixture();
        const account = { expectedRevision: hash, accountKey: "qq.account.with.dots" };
        await run(["remove-account", "--draft", uuid, "--stdin"], JSON.stringify(account));
        expect(calls[0]).toMatchObject({
            route: `/api/control/configuration/drafts/${uuid}/remove-account`,
            body: account,
        });
        for (const accountKey of [null, "qq.account.with.dots"]) {
            const body = {
                expectedRevision: hash,
                accountKey,
                protocol: "custom.registered-name",
                enabled: false,
            };
            await run(["protocol", "--draft", uuid, "--stdin"], JSON.stringify(body));
            expect(calls.at(-1)).toMatchObject({
                route: `/api/control/configuration/drafts/${uuid}/protocol`,
                body,
            });
        }
        await run(["--help"]);
        expect(output.mock.calls.at(-1)?.[0]).toContain("remove-account");
        expect(output.mock.calls.at(-1)?.[0]).toContain("accountKey 为 null");
    });

    it("协议和账号删除要求完整stdin字段且不接受隐式默认", async () => {
        const { run, calls } = fixture();
        await expect(
            run(
                ["remove-account", "--draft", uuid, "--stdin"],
                JSON.stringify({ expectedRevision: hash, accountKey: null }),
            ),
        ).rejects.toThrow();
        for (const body of [
            { expectedRevision: hash, accountKey: null, protocol: "onebot.v11" },
            { expectedRevision: hash, accountKey: null, protocol: "onebot.v11", enabled: "false" },
            {
                expectedRevision: hash,
                accountKey: null,
                protocol: "onebot.v11",
                enabled: true,
                token: "secret",
            },
        ])
            await expect(
                run(["protocol", "--draft", uuid, "--stdin"], JSON.stringify(body)),
            ).rejects.toThrow();
        await expect(run(["protocol", "--draft", uuid])).rejects.toThrow();
        expect(calls).toEqual([]);
    });
    it("create只取当前基线创建草稿，不验证或应用原始配置", async () => {
        const { run, calls } = fixture();
        await run(["create"]);
        expect(calls.map(call => call.route)).toEqual([
            "/api/control/configuration",
            "/api/control/configuration/drafts",
        ]);
        expect(calls[1].body).toEqual({ base: { generationId: null, configRevision: hash } });
    });
    it("管道传递秘密patch且输出仅服务脱敏结果", async () => {
        const { run, calls, output } = fixture();
        await run(
            ["edit", "--draft", uuid, "--stdin"],
            JSON.stringify({
                expectedRevision: hash,
                changes: [],
                secrets: [{ op: "set", path: ["qq.a", "password"], value: "secret-value" }],
            }),
        );
        expect(JSON.stringify(calls[0].body)).toContain("secret-value");
        expect(JSON.stringify(output.mock.calls)).not.toContain("secret-value");
    });
    it("错误不得带出JSON、服务异常或argv中的秘密", async () => {
        const { run, request, output } = fixture();
        request.mockRejectedValue(new Error("secret-value"));
        await expect(run(["snapshot"])).rejects.not.toThrow("secret-value");
        await expect(
            run(["edit", "--draft", uuid, "--stdin"], '{"secret-value"'),
        ).rejects.not.toThrow("secret-value");
        await expect(run(["edit", "--draft", uuid, "--value", "secret-value"])).rejects.not.toThrow(
            "secret-value",
        );
        expect(output).not.toHaveBeenCalled();
    });
    it("拒绝TTY、超1MiB输入、缺参数及重复参数", async () => {
        const { run, calls } = fixture();
        const args = ["edit", "--draft", uuid, "--stdin"];
        await expect(run(args, "{}", true)).rejects.toThrow();
        await expect(run(args, "x".repeat(1_048_577))).rejects.toThrow();
        await expect(run(["apply", "--receipt", uuid])).rejects.toThrow();
        await expect(run(["read", "--draft", uuid, "--draft", uuid])).rejects.toThrow();
        expect(calls).toEqual([]);
    });
    it("应用与重试都保留显式操作ID和收据，查询不重放", async () => {
        const { run, calls } = fixture();
        const args = ["apply", "--request", "same-operation", "--receipt", uuid];
        await run(args);
        await run(args);
        await run(["operation", "--request", "same-operation"]);
        expect(calls[0].body).toEqual({ id: "same-operation", receiptId: uuid });
        expect(calls[1]).toEqual(calls[0]);
        expect(calls[2].method).toBe("GET");
    });
    it("read、validate、add-account与帮助明确分发", async () => {
        const { run, calls, output } = fixture();
        await run(["read", "--draft", uuid]);
        await run(["validate", "--draft", uuid, "--revision", hash]);
        await run(
            ["add-account", "--draft", uuid, "--stdin"],
            JSON.stringify({ expectedRevision: hash, platform: "qq", accountId: "a.b" }),
        );
        expect(calls[1].body).toEqual({ expectedRevision: hash });
        expect(calls[2].body).toEqual({ expectedRevision: hash, platform: "qq", accountId: "a.b" });
        await run(["--help"]);
        expect(output.mock.calls.at(-1)?.[0]).toContain("重试沿用同一操作ID");
    });
});
