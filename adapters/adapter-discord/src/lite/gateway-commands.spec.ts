import { describe, expect, it } from "vitest";
import { compileDiscordGatewayCommand, parseDiscordGatewayCommand } from "./gateway-commands.js";
import { GatewayOpcodes } from "./gateway-types.js";

describe("Discord Gateway commands", () => {
    it.each([
        [
            {
                type: "update_presence" as const,
                since: null,
                activities: [{ name: "OneBots", type: 0 }],
                status: "online" as const,
                afk: false,
            },
            GatewayOpcodes.PresenceUpdate,
        ],
        [
            {
                type: "update_voice_state" as const,
                guild_id: "1",
                channel_id: null,
                self_mute: false,
                self_deaf: true,
            },
            GatewayOpcodes.VoiceStateUpdate,
        ],
        [
            { type: "request_guild_members" as const, guild_id: "1", query: "", limit: 0 },
            GatewayOpcodes.RequestGuildMembers,
        ],
        [
            { type: "request_soundboard_sounds" as const, guild_ids: ["1", "2"] },
            GatewayOpcodes.RequestSoundboardSounds,
        ],
        [
            {
                type: "request_channel_info" as const,
                guild_id: "1",
                fields: ["status" as const],
            },
            GatewayOpcodes.RequestChannelInfo,
        ],
    ])("编译 %s 为官方 opcode", (command, opcode) => {
        const payload = compileDiscordGatewayCommand(command);

        expect(payload.op).toBe(opcode);
        expect(payload.d).not.toHaveProperty("type");
    });

    it("拒绝未知命令、不完整载荷和冲突的成员查询", () => {
        expect(() => parseDiscordGatewayCommand({ type: "unknown" })).toThrow("不是受支持");
        expect(() =>
            parseDiscordGatewayCommand({
                type: "update_voice_state",
                guild_id: "1",
                channel_id: null,
            }),
        ).toThrow("必须为布尔值");
        expect(() =>
            parseDiscordGatewayCommand({
                type: "request_guild_members",
                guild_id: "1",
                query: "",
                user_ids: ["2"],
                limit: 0,
            }),
        ).toThrow("必须且只能提供一个");
    });
});
