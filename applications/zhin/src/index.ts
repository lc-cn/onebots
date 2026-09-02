import {
    ApplicationRegistry,
    defineApplication,
    type ApplicationProtocolExtension,
    type Protocol,
} from "onebots";

const REQUIRED_ACTIONS = ["get_login_info", "send_private_msg"] as const;

export const zhinApplication = defineApplication({
    name: "zhin",
    displayName: "Zhin",
    description: "声明 Zhin 使用 OneBot 11 时依赖的标准动作与兼容边界。",
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
    return {
        capability: {
            connections: [
                {
                    id: "onebot-v11-forward-websocket",
                    transport: "websocket",
                    direction: "onebots-listens",
                    endpoint: protocol.path,
                    description: "使用用户在 OneBot 11 中显式启用的正向 WebSocket。",
                },
            ],
            actions: [],
            requiredActions: [...REQUIRED_ACTIONS],
            unsupportedActions: [],
            routes: [],
            limitations: ["Application 不会代替协议配置开启 WebSocket 或其他传输。"],
        },
    };
}
