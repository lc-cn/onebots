import { definePlatformActions, type PlatformActionHandler } from "onebots";
import {
    optionalBoolean,
    optionalNonNegativeInteger,
    optionalObject,
    optionalString,
    requireBoolean,
    requireMethod,
    requireObject,
    requireString,
} from "./action-params.js";
import type { MatrixClient } from "./client.js";
import { MatrixError } from "./errors.js";
import type { MatrixCreateRoomParams } from "./types.js";

const handlers = {
    call_matrix_api: (client, params) =>
        client.call(requireMethod(params.method), requireString(params.path, "path"), {
            body: params.body,
            query: parseQuery(params.query),
        }),
    create_matrix_room: (client, params) => client.createRoom(parseCreateRoomParams(params)),
    join_matrix_room: (client, params) =>
        client.call(
            "POST",
            `/_matrix/client/v3/join/${encodeURIComponent(requireString(params.room_id_or_alias, "room_id_or_alias"))}`,
            { body: { reason: optionalString(params.reason, "reason") } },
        ),
    knock_matrix_room: (client, params) =>
        client.call(
            "POST",
            `/_matrix/client/v3/knock/${encodeURIComponent(requireString(params.room_id_or_alias, "room_id_or_alias"))}`,
            { body: { reason: optionalString(params.reason, "reason") } },
        ),
    ban_matrix_member: (client, params) => roomMemberAction(client, "ban", params),
    unban_matrix_member: (client, params) => roomMemberAction(client, "unban", params),
    set_matrix_room_topic: (client, params) =>
        sendState(client, params, "m.room.topic", { topic: requireString(params.topic, "topic") }),
    send_matrix_state_event: (client, params) =>
        sendState(
            client,
            params,
            requireString(params.event_type, "event_type"),
            requireObject(params.content, "content"),
        ),
    send_matrix_typing: (client, params) =>
        client.call(
            "PUT",
            `/_matrix/client/v3/rooms/${encodeURIComponent(requireString(params.room_id, "room_id"))}/typing/${encodeURIComponent(client.userId)}`,
            {
                body: {
                    typing: requireBoolean(params.typing, "typing"),
                    timeout: optionalNonNegativeInteger(params.timeout, "timeout"),
                },
            },
        ),
    set_matrix_presence: (client, params) =>
        client.call(
            "PUT",
            `/_matrix/client/v3/presence/${encodeURIComponent(client.userId)}/status`,
            {
                body: {
                    presence: requirePresence(params.presence),
                    status_msg: optionalString(params.status_msg, "status_msg"),
                },
            },
        ),
    get_matrix_room_state: (client, params) =>
        client.call(
            "GET",
            `/_matrix/client/v3/rooms/${encodeURIComponent(requireString(params.room_id, "room_id"))}/state`,
        ),
    get_matrix_public_rooms: (client, params) =>
        client.call("POST", "/_matrix/client/v3/publicRooms", {
            body: optionalObject(params.filter, "filter"),
            query: { server: optionalString(params.server, "server") },
        }),
    set_matrix_read_markers: (client, params) =>
        client.call(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(requireString(params.room_id, "room_id"))}/read_markers`,
            {
                body: {
                    "m.fully_read": optionalString(
                        params.fully_read_event_id,
                        "fully_read_event_id",
                    ),
                    "m.read": optionalString(params.read_event_id, "read_event_id"),
                    "m.read.private": optionalString(
                        params.private_read_event_id,
                        "private_read_event_id",
                    ),
                },
            },
        ),
    ping_matrix_appservice: (client, params) => {
        const appserviceId = client.config.appservice_id;
        if (!appserviceId) throw MatrixError.invalid("当前账号未配置 appservice_id");
        return client.call(
            "POST",
            `/_matrix/client/v1/appservice/${encodeURIComponent(appserviceId)}/ping`,
            {
                token: "appservice",
                body: { transaction_id: optionalString(params.transaction_id, "transaction_id") },
            },
        );
    },
} satisfies Readonly<Record<string, PlatformActionHandler<MatrixClient>>>;

const actions = definePlatformActions(
    handlers,
    action =>
        new MatrixError(`未实现 Matrix 平台动作: ${action}`, {
            code: "MATRIX_ACTION_NOT_IMPLEMENTED",
        }),
);

export const MATRIX_PLATFORM_ACTIONS = actions.actions;
export type MatrixPlatformAction =
    typeof MATRIX_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

export function executeMatrixPlatformAction(
    client: MatrixClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return actions.execute(client, action, params);
}

function roomMemberAction(
    client: MatrixClient,
    action: "ban" | "unban",
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return client.call(
        "POST",
        `/_matrix/client/v3/rooms/${encodeURIComponent(requireString(params.room_id, "room_id"))}/${action}`,
        {
            body: {
                user_id: requireString(params.user_id, "user_id"),
                reason: optionalString(params.reason, "reason"),
            },
        },
    );
}

function sendState(
    client: MatrixClient,
    params: Readonly<Record<string, unknown>>,
    eventType: string,
    content: Record<string, unknown>,
): Promise<unknown> {
    const stateKey = optionalString(params.state_key, "state_key") || "";
    return client.call(
        "PUT",
        `/_matrix/client/v3/rooms/${encodeURIComponent(requireString(params.room_id, "room_id"))}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
        { body: content },
    );
}

function parseQuery(value: unknown): Record<string, string | number | boolean | undefined> {
    const record = optionalObject(value, "query");
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(record)) {
        if (
            !["string", "number", "boolean", "undefined"].includes(typeof item) ||
            (typeof item === "number" && !Number.isFinite(item))
        ) {
            throw MatrixError.invalid(`query.${key} 必须是标量`);
        }
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}

function parseCreateRoomParams(params: Readonly<Record<string, unknown>>): MatrixCreateRoomParams {
    const invite = params.invite;
    if (
        invite !== undefined &&
        (!Array.isArray(invite) || invite.some(value => typeof value !== "string"))
    ) {
        throw MatrixError.invalid("invite 必须是 Matrix user_id 字符串数组");
    }
    return {
        name: optionalString(params.name, "name"),
        topic: optionalString(params.topic, "topic"),
        room_alias_name: optionalString(params.room_alias_name, "room_alias_name"),
        visibility: parseVisibility(params.visibility),
        preset: parsePreset(params.preset),
        invite: invite as string[] | undefined,
        is_direct: optionalBoolean(params.is_direct, "is_direct"),
        room_version: optionalString(params.room_version, "room_version"),
    };
}

function parseVisibility(value: unknown): MatrixCreateRoomParams["visibility"] {
    if (value === undefined || value === "private") return "private";
    if (value === "public") return "public";
    throw MatrixError.invalid("visibility 必须是 private 或 public");
}

function parsePreset(value: unknown): MatrixCreateRoomParams["preset"] {
    if (value === undefined) return undefined;
    if (["private_chat", "public_chat", "trusted_private_chat"].includes(String(value))) {
        return value as MatrixCreateRoomParams["preset"];
    }
    throw MatrixError.invalid("preset 不是 Matrix 支持的房间预设");
}

function requirePresence(value: unknown): "offline" | "online" | "unavailable" {
    if (value === "offline" || value === "online" || value === "unavailable") return value;
    throw MatrixError.invalid("presence 必须是 offline、online 或 unavailable");
}
