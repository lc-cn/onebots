import { describe, it, expect, vi } from "vitest";
import { MCP_TOOLS, executeTool, filterTools } from "../tools.js";

describe("MCP_TOOLS", () => {
    it("exports 31 tools", () => {
        expect(MCP_TOOLS).toHaveLength(31);
    });

    it("every tool has name, description, and inputSchema", () => {
        for (const tool of MCP_TOOLS) {
            expect(tool.name).toBeTruthy();
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema.type).toBe("object");
        }
    });

    it("tool names are unique", () => {
        const names = MCP_TOOLS.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("contains expected core tools", () => {
        const names = MCP_TOOLS.map(t => t.name);
        expect(names).toContain("send_message");
        expect(names).toContain("get_login_info");
        expect(names).toContain("get_group_list");
        expect(names).toContain("get_friend_list");
        expect(names).toContain("get_status");
    });
});

describe("filterTools", () => {
    it("returns all tools when no filter is set", () => {
        const result = filterTools(MCP_TOOLS);
        expect(result).toHaveLength(MCP_TOOLS.length);
    });

    it("returns all tools with empty whitelist", () => {
        const result = filterTools(MCP_TOOLS, []);
        expect(result).toHaveLength(MCP_TOOLS.length);
    });

    it("filters by whitelist", () => {
        const result = filterTools(MCP_TOOLS, ["send_message", "get_login_info"]);
        expect(result).toHaveLength(2);
        expect(result.map(t => t.name)).toEqual(["send_message", "get_login_info"]);
    });

    it("filters by blacklist", () => {
        const result = filterTools(MCP_TOOLS, undefined, ["kick_group_member", "delete_friend"]);
        expect(result.find(t => t.name === "kick_group_member")).toBeUndefined();
        expect(result.find(t => t.name === "delete_friend")).toBeUndefined();
        expect(result.length).toBe(MCP_TOOLS.length - 2);
    });

    it("whitelist + blacklist combined", () => {
        const result = filterTools(
            MCP_TOOLS,
            ["send_message", "get_login_info", "kick_group_member"],
            ["kick_group_member"],
        );
        expect(result).toHaveLength(2);
        expect(result.map(t => t.name)).toEqual(["send_message", "get_login_info"]);
    });
});

describe("executeTool", () => {
    function mockAdapter(overrides: Record<string, unknown> = {}) {
        return {
            resolveId: vi.fn((id: string | number) => ({
                string: String(id),
                number: typeof id === "number" ? id : parseInt(id, 10) || 0,
                source: String(id),
            })),
            sendMessage: vi.fn().mockResolvedValue({
                message_id: { string: "msg_1", number: 1, source: "msg_1" },
            }),
            getLoginInfo: vi.fn().mockResolvedValue({
                user_id: { string: "bot_123", number: 123 },
                user_name: "TestBot",
                avatar: "https://example.com/avatar.png",
            }),
            getGroupList: vi.fn().mockResolvedValue([
                { group_id: { string: "g1" }, group_name: "Group 1", member_count: 10 },
                { group_id: { string: "g2" }, group_name: "Group 2", member_count: 20 },
            ]),
            getFriendList: vi
                .fn()
                .mockResolvedValue([
                    { user_id: { string: "u1" }, user_name: "Friend 1", remark: "f1" },
                ]),
            getStatus: vi.fn().mockResolvedValue({ online: true, good: true }),
            getVersion: vi.fn().mockResolvedValue({ app: "onebots", version: "1.0.0" }),
            ...overrides,
        } as never;
    }

    it("returns error for unknown tool", async () => {
        const result = await executeTool(mockAdapter(), "bot", "nonexistent_tool", {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("未知的 Tool");
    });

    it("executes get_login_info", async () => {
        const adapter = mockAdapter();
        const result = await executeTool(adapter, "bot", "get_login_info", {});
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text!);
        expect(data.user_id).toBe("bot_123");
        expect(data.user_name).toBe("TestBot");
    });

    it("executes send_message", async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            message_id: { string: "msg_1", number: 1, source: "msg_1" },
        });
        const adapter = mockAdapter({ sendMessage });
        const result = await executeTool(adapter, "bot", "send_message", {
            scene_type: "group",
            scene_id: "12345",
            message: "Hello!",
        });
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text!);
        expect(data.message_id).toBe("msg_1");
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it("preserves relationship block policies and rejects invalid booleans", async () => {
        const handleFriendRequest = vi.fn().mockResolvedValue(undefined);
        const adapter = mockAdapter({ handleFriendRequest });

        const result = await executeTool(adapter, "bot", "handle_friend_request", {
            flag: "opaque-flag",
            approve: false,
            block: true,
        });
        expect(result.isError).toBeUndefined();
        expect(handleFriendRequest).toHaveBeenCalledWith("bot", {
            flag: "opaque-flag",
            approve: false,
            remark: undefined,
            block: true,
        });

        await expect(
            executeTool(adapter, "bot", "handle_friend_request", {
                flag: "opaque-flag",
                approve: "false",
            }),
        ).resolves.toMatchObject({ isError: true });
    });

    it("executes get_group_list", async () => {
        const adapter = mockAdapter();
        const result = await executeTool(adapter, "bot", "get_group_list", {});
        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text!);
        expect(data).toHaveLength(2);
        expect(data[0].group_name).toBe("Group 1");
    });

    it("executes get_status", async () => {
        const adapter = mockAdapter();
        const result = await executeTool(adapter, "bot", "get_status", {});
        const data = JSON.parse(result.content[0].text!);
        expect(data.online).toBe(true);
        expect(data.good).toBe(true);
    });

    it("handles adapter errors gracefully", async () => {
        const adapter = mockAdapter({
            getLoginInfo: vi.fn().mockRejectedValue(new Error("Network error")),
        });
        const result = await executeTool(adapter, "bot", "get_login_info", {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Network error");
    });
});
