import { describe, expect, it } from "vitest";
import { DiscordREST } from "./rest.js";

describe("DiscordREST endpoint boundary", () => {
    it("在发送 token 前拒绝外部 URL、路径穿越和内嵌 query", async () => {
        const rest = new DiscordREST({ token: "secret" });
        await expect(rest.request("https://example.com/api")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/guilds/../users/@me")).rejects.toThrow("安全绝对路径");
        await expect(rest.request("/users/@me?with_counts=true")).rejects.toThrow("安全绝对路径");
    });
});
