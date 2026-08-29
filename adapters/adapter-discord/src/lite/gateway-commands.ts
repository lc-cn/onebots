import { DiscordError } from "../errors.js";
import { GatewayOpcodes } from "./gateway-types.js";

export type DiscordPresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";
export type DiscordChannelInfoField = "status" | "voice_start_time";

export type DiscordGatewayCommand =
    | {
          type: "update_presence";
          since: number | null;
          activities: ReadonlyArray<Readonly<Record<string, unknown>>>;
          status: DiscordPresenceStatus;
          afk: boolean;
      }
    | {
          type: "update_voice_state";
          guild_id: string;
          channel_id: string | null;
          self_mute: boolean;
          self_deaf: boolean;
      }
    | {
          type: "request_guild_members";
          guild_id: string;
          query?: string;
          limit?: number;
          presences?: boolean;
          user_ids?: string | readonly string[];
          nonce?: string;
      }
    | { type: "request_soundboard_sounds"; guild_ids: readonly string[] }
    | {
          type: "request_channel_info";
          guild_id: string;
          fields: readonly DiscordChannelInfoField[];
      };

export interface DiscordGatewayCommandPayload {
    op: number;
    d: Readonly<Record<string, unknown>>;
}

/** 将公开命令收口为 Discord Gateway v10 的 opcode 与载荷。 */
export function compileDiscordGatewayCommand(
    command: DiscordGatewayCommand,
): DiscordGatewayCommandPayload {
    switch (command.type) {
        case "update_presence":
            validatePresence(command);
            return { op: GatewayOpcodes.PresenceUpdate, d: omitType(command) };
        case "update_voice_state":
            requireSnowflake(command.guild_id, "guild_id");
            if (command.channel_id !== null) requireSnowflake(command.channel_id, "channel_id");
            if (typeof command.self_mute !== "boolean" || typeof command.self_deaf !== "boolean") {
                invalid("self_mute 与 self_deaf 必须为布尔值");
            }
            return { op: GatewayOpcodes.VoiceStateUpdate, d: omitType(command) };
        case "request_guild_members":
            validateMemberRequest(command);
            return { op: GatewayOpcodes.RequestGuildMembers, d: omitType(command) };
        case "request_soundboard_sounds":
            if (!Array.isArray(command.guild_ids)) invalid("guild_ids 必须为数组");
            requireSnowflakeArray(command.guild_ids, "guild_ids");
            return { op: GatewayOpcodes.RequestSoundboardSounds, d: omitType(command) };
        case "request_channel_info":
            requireSnowflake(command.guild_id, "guild_id");
            if (
                !Array.isArray(command.fields) ||
                command.fields.length === 0 ||
                command.fields.some(field => field !== "status" && field !== "voice_start_time")
            ) {
                invalid("fields 必须包含 status 或 voice_start_time");
            }
            return { op: GatewayOpcodes.RequestChannelInfo, d: omitType(command) };
        default:
            return invalid("command.type 不是受支持的 Gateway 主动事件");
    }
}

/** 校验协议动作传入的未知对象，并恢复强类型命令。 */
export function parseDiscordGatewayCommand(value: unknown): DiscordGatewayCommand {
    if (!isRecord(value) || typeof value.type !== "string") invalid("command.type 不能为空");
    const command = value as DiscordGatewayCommand;
    compileDiscordGatewayCommand(command);
    return command;
}

function validatePresence(command: Extract<DiscordGatewayCommand, { type: "update_presence" }>) {
    if (command.since !== null && (!Number.isInteger(command.since) || command.since < 0)) {
        invalid("since 必须为非负整数或 null");
    }
    if (!Array.isArray(command.activities)) invalid("activities 必须为数组");
    for (const activity of command.activities) {
        if (!isRecord(activity) || typeof activity.name !== "string") {
            invalid("activity.name 必须为字符串");
        }
        if (!Number.isInteger(activity.type)) invalid("activity.type 必须为整数");
    }
    if (!["online", "idle", "dnd", "invisible", "offline"].includes(command.status)) {
        invalid("status 不是有效的 Discord presence 状态");
    }
    if (typeof command.afk !== "boolean") invalid("afk 必须为布尔值");
}

function validateMemberRequest(
    command: Extract<DiscordGatewayCommand, { type: "request_guild_members" }>,
) {
    requireSnowflake(command.guild_id, "guild_id");
    if ((command.query === undefined) === (command.user_ids === undefined)) {
        invalid("query 与 user_ids 必须且只能提供一个");
    }
    if (command.query !== undefined) {
        if (typeof command.query !== "string") invalid("query 必须为字符串");
        if (!Number.isInteger(command.limit) || command.limit! < 0 || command.limit! > 100) {
            invalid("limit 必须为 0-100 的整数");
        }
    }
    if (command.user_ids !== undefined) {
        const userIds = Array.isArray(command.user_ids) ? command.user_ids : [command.user_ids];
        requireSnowflakeArray(userIds, "user_ids", 100);
    }
    if (command.presences !== undefined && typeof command.presences !== "boolean") {
        invalid("presences 必须为布尔值");
    }
    if (command.nonce !== undefined) {
        if (typeof command.nonce !== "string") invalid("nonce 必须为字符串");
        if (new TextEncoder().encode(command.nonce).length > 32) {
            invalid("nonce 不能超过 32 字节");
        }
    }
}

function omitType(command: DiscordGatewayCommand): Readonly<Record<string, unknown>> {
    const payload: Record<string, unknown> = { ...command };
    delete payload.type;
    return payload;
}

function requireSnowflake(value: unknown, field: string): asserts value is string {
    if (typeof value !== "string" || !/^\d+$/.test(value)) invalid(`${field} 必须为 snowflake`);
}

function requireSnowflakeArray(values: readonly unknown[], field: string, max?: number): void {
    if (values.length === 0 || (max !== undefined && values.length > max)) {
        invalid(`${field} 数量必须为 1${max ? `-${max}` : " 个以上"}`);
    }
    for (const value of values) requireSnowflake(value, field);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
    throw DiscordError.invalid(message, "DISCORD_GATEWAY_COMMAND_INVALID");
}
