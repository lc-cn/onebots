import { describe, expect, it } from "vitest";
import { createSlackDispatcher, createSlackFetch } from "./transport.js";

describe("Slack transport", () => {
    it.each(["http://127.0.0.1:7890", "https://proxy.example", "socks5://127.0.0.1:1080"])(
        "为 Web API 与 Socket Mode 创建共用代理 %s",
        async url => {
            const dispatcher = createSlackDispatcher({ url, username: "user", password: "pass" });
            expect(dispatcher).toBeDefined();
            expect(createSlackFetch(dispatcher)).toBeTypeOf("function");
            await dispatcher?.close();
        },
    );

    it.each([
        "ftp://proxy.example",
        "http://embedded:secret@proxy.example",
        "http://proxy.example?target=evil",
    ])("在网络请求前拒绝不安全代理 %s", url => {
        expect(() => createSlackDispatcher({ url })).toThrow("Slack 代理");
    });
});
