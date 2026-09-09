import yaml from "js-yaml";
import { listFrameworkEcosystem } from "./framework-ecosystem.js";
import { SHARED_TOKEN } from "./framework-integration-connection.js";
import type { FrameworkConfigRenderContext } from "./framework-integration-types.js";

export function renderEcosystemFrameworkConfig(
    { profile, endpoint, frameworkOrigin }: FrameworkConfigRenderContext,
    entry: ReturnType<typeof listFrameworkEcosystem>[number],
): string {
    switch (profile.id) {
        case "overflow":
            return JSON.stringify(
                {
                    connections: [
                        {
                            enable: true,
                            type: "websocket",
                            host: endpoint,
                            token: SHARED_TOKEN,
                        },
                    ],
                },
                null,
                2,
            );
        case "nonebot1":
            return [
                "# NoneBot 1 / aiocqhttp 存量配置",
                `HOST=${frameworkOrigin!.hostname}`,
                `PORT=${frameworkOrigin!.port || "8080"}`,
                `ACCESS_TOKEN=${SHARED_TOKEN}`,
                `# OneBots 反向连接 ${endpoint}`,
            ].join("\n");
        case "genshinuid":
            return yaml.dump({
                host: "nonebot2-or-other-supported-host",
                plugin: "GenshinUID",
                core: "gsuid-core",
                onebot_reverse_websocket: endpoint,
                access_token: SHARED_TOKEN,
            });
        case "walle":
            return [
                '// Cargo.toml: walle-core = { features = ["app-obc", "websocket"] }',
                "// AppConfig 中启用 OneBot 12 正向 WebSocket：",
                `// url = ${JSON.stringify(endpoint)}`,
                `// access_token = ${JSON.stringify(SHARED_TOKEN)}`,
            ].join("\n");
        case "simbot-onebot":
            return [
                "# simbot-component-onebot-v11 bot configuration",
                `url=${endpoint}`,
                `accessToken=${SHARED_TOKEN}`,
                "component=onebot-v11",
            ].join("\n");
        case "shiro":
            return yaml.dump({
                shiro: {
                    websocket: { url: endpoint, accessToken: SHARED_TOKEN },
                },
            });
        default:
            return yaml.dump({
                application: profile.id,
                stage: entry.runtime.stage,
                protocol: profile.protocol,
                connection: {
                    transport: profile.transport,
                    endpoint,
                    access_token: SHARED_TOKEN,
                },
                note: entry.limitation,
            });
    }
}
