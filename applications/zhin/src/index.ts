import {
    ApplicationRegistry,
    defineApplication,
    type ApplicationProtocolExtension,
    type Protocol,
    type WsServer,
} from "onebots";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";

const APPLICATION_NAME = "zhin";
const REQUIRED_ACTIONS = ["get_login_info", "send_private_msg"] as const;

export const zhinApplication = defineApplication({
    name: APPLICATION_NAME,
    displayName: "Zhin",
    description: "为 Zhin 提供 OneBot 11 兼容动作、专用 WebSocket 与连接能力描述。",
    homepage: "https://zhinjs.com",
    createProtocolExtension(protocol) {
        if (protocol.name !== "onebot" || protocol.version !== "v11") return undefined;
        return createOneBotV11Extension(protocol);
    },
    unsupportedProtocol(protocol) {
        return [
            `Zhin 6 的官方适配器尚未为 ${protocol.name}.${protocol.version} 提供已验证连接器；请启用 onebot.v11。`,
        ];
    },
});

ApplicationRegistry.register(zhinApplication);

function createOneBotV11Extension(protocol: Protocol): ApplicationProtocolExtension {
    const route = `${protocol.path}/applications/zhin`;
    const activeConnections = new Set<WebSocket>();
    let server: WsServer | undefined;
    return {
        capability: {
            connections: [
                {
                    id: "onebot-v11-forward-websocket",
                    transport: "websocket",
                    direction: "onebots-listens",
                    endpoint: route,
                    description: "Zhin OneBot 11 adapter 连接的专用正向 WebSocket。",
                },
            ],
            actions: [...REQUIRED_ACTIONS, "get_zhin_application_info"],
            routes: [route],
            limitations: ["当前固定版本门禁覆盖私聊消息与两个基础动作。"],
        },
        async start({ next }) {
            await next();
            server = protocol.router.ws(route);
            server.on("connection", (socket, request) =>
                attachClient(protocol, socket, request, activeConnections),
            );
            protocol.logger.info(`[Zhin] 专用 WebSocket 已监听 ${route}`);
        },
        async stop({ next }) {
            for (const socket of activeConnections) socket.close(1001, "OneBots stopping");
            activeConnections.clear();
            server?.close();
            server = undefined;
            await next();
        },
        async apply({ action, next }) {
            if (action !== "get_zhin_application_info") return next();
            return {
                status: "ok",
                retcode: 0,
                data: {
                    application: APPLICATION_NAME,
                    protocol: "onebot.v11",
                    websocket: route,
                    required_actions: [...REQUIRED_ACTIONS],
                },
            };
        },
    };
}

function attachClient(
    protocol: Protocol,
    socket: WebSocket,
    request: IncomingMessage,
    activeConnections: Set<WebSocket>,
): void {
    if (!verifyToken(protocol, request)) {
        socket.close(1008, "Unauthorized");
        return;
    }
    activeConnections.add(socket);
    const onDispatch = (data: unknown) => {
        if (socket.readyState !== 1) return;
        socket.send(typeof data === "string" ? data : JSON.stringify(data));
    };
    protocol.on("dispatch", onDispatch);
    socket.send(
        JSON.stringify(
            protocol.format("meta_event", {
                meta_event_type: "lifecycle",
                sub_type: "connect",
            }),
        ),
    );
    socket.on("message", data => {
        void handleRequest(protocol, socket, data.toString());
    });
    socket.on("close", () => {
        activeConnections.delete(socket);
        protocol.off("dispatch", onDispatch);
    });
    socket.on("error", error => protocol.logger.error("[Zhin] WebSocket 连接异常", error));
}

async function handleRequest(protocol: Protocol, socket: WebSocket, data: string): Promise<void> {
    try {
        const request = JSON.parse(data) as Record<string, unknown>;
        if (typeof request.action !== "string" || !request.action.trim()) {
            throw new TypeError("action 必须是非空字符串");
        }
        const params = isRecord(request.params) ? request.params : undefined;
        const result = await protocol.apply(request.action, params);
        socket.send(
            JSON.stringify(
                request.echo === undefined ? result : { ...asRecord(result), echo: request.echo },
            ),
        );
    } catch (error) {
        protocol.logger.error("[Zhin] WebSocket 动作调用失败", error);
        socket.send(
            JSON.stringify({
                status: "failed",
                retcode: -1,
                msg: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}

function verifyToken(protocol: Protocol, request: IncomingMessage): boolean {
    const configured = (protocol.config as Record<string, unknown>).access_token;
    if (typeof configured !== "string" || configured === "") return true;
    const url = new URL(request.url ?? "/", "ws://localhost");
    const supplied =
        url.searchParams.get("access_token") ??
        request.headers.authorization?.replace("Bearer ", "");
    return supplied === configured;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : { data: value };
}
