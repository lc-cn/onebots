import yaml from "js-yaml";
import { ApplicationRegistry } from "@onebots/core";
import { listFrameworkEcosystem } from "./framework-ecosystem.js";
import { createProfileApplication } from "./framework-integration-application.js";
import {
    renderBuiltinFrameworkConfig,
    resolveReverseFrameworkEndpoint,
    SHARED_TOKEN,
} from "./framework-integration-connection.js";
import { renderEcosystemFrameworkConfig } from "./framework-integration-ecosystem-renderer.js";
import { BUILTIN_PROFILES, ECOSYSTEM_PROFILES } from "./framework-integration-profiles.js";
import {
    defineFrameworkIntegration,
    FrameworkIntegrationRegistry,
} from "./framework-integration-types.js";

const zhinIntegration = defineFrameworkIntegration({
    profile: BUILTIN_PROFILES.zhin,
    renderFrameworkConfig: ({ endpoint }) =>
        yaml.dump({
            plugins: {
                onebot11: {
                    connection: "ws",
                    name: "onebots",
                    url: endpoint,
                    access_token: SHARED_TOKEN,
                },
            },
        }),
});

const astrbotIntegration = defineFrameworkIntegration({
    profile: BUILTIN_PROFILES.astrbot,
    resolveEndpoint: ({ frameworkOrigin }) =>
        resolveReverseFrameworkEndpoint(frameworkOrigin!, "/ws"),
    renderFrameworkConfig: ({ frameworkOrigin }) =>
        yaml.dump({
            id: "onebots",
            type: "aiocqhttp",
            enable: true,
            ws_reverse_host: frameworkOrigin!.hostname,
            ws_reverse_port: Number(frameworkOrigin!.port || 6199),
            ws_reverse_token: SHARED_TOKEN,
        }),
});

const langbotIntegration = defineFrameworkIntegration({
    profile: BUILTIN_PROFILES.langbot,
    resolveEndpoint: ({ frameworkOrigin }) =>
        resolveReverseFrameworkEndpoint(frameworkOrigin!, "/ws"),
    renderFrameworkConfig: ({ frameworkOrigin }) =>
        yaml.dump({
            adapter: "aiocqhttp",
            enable: true,
            host: frameworkOrigin!.hostname,
            port: Number(frameworkOrigin!.port || 2280),
            "access-token": SHARED_TOKEN,
        }),
});

const alicebotIntegration = defineFrameworkIntegration({
    profile: BUILTIN_PROFILES.alicebot,
    resolveEndpoint: ({ frameworkOrigin }) =>
        resolveReverseFrameworkEndpoint(frameworkOrigin!, "/cqhttp/ws"),
    renderFrameworkConfig: ({ frameworkOrigin }) =>
        [
            "# onebots_alicebot.py",
            "from aiohttp import web",
            "from alicebot.adapter.cqhttp import CQHTTPAdapter",
            "",
            "class OneBotsCQHTTPAdapter(CQHTTPAdapter):",
            "    async def handle_reverse_ws_response(self, request: web.Request):",
            "        token = self.config.access_token",
            "        supplied = request.query.get('access_token')",
            "        authorization = request.headers.get('Authorization', '')",
            "        if token and supplied != token and authorization != f'Bearer {token}':",
            "            return web.Response(status=401, text='Unauthorized')",
            "        self.websocket = web.WebSocketResponse()",
            "        await self.websocket.prepare(request)",
            "        await self.handle_websocket()",
            "        return self.websocket",
            "",
            "# config.toml",
            "[bot]",
            'adapters = ["onebots_alicebot"]',
            "[adapter.cqhttp]",
            'adapter_type = "reverse-ws"',
            `host = ${JSON.stringify(frameworkOrigin!.hostname)}`,
            `port = ${frameworkOrigin!.port || "8080"}`,
            'url = "/cqhttp/ws"',
            `access_token = ${JSON.stringify(SHARED_TOKEN)}`,
        ].join("\n"),
});

const kotoriIntegration = defineFrameworkIntegration({
    profile: BUILTIN_PROFILES.kotori,
    resolveEndpoint: ({ frameworkOrigin }) =>
        resolveReverseFrameworkEndpoint(frameworkOrigin!, "/adapter/onebots"),
    renderFrameworkConfig: ({ frameworkOrigin }) =>
        [
            "// onebots-adapter.ts",
            'import { OnebotAdapter } from "@kotori-bot/kotori-plugin-adapter-onebot";',
            "",
            "export class OneBotsOnebotAdapter extends OnebotAdapter {",
            "    constructor(ctx, config, identity) {",
            "        super(ctx, config, identity);",
            "        const connect = this.connection.bind(this);",
            "        this.connection = (socket, request) => {",
            "            const url = new URL(request.url ?? '/', 'ws://localhost');",
            "            const authorization = request.headers.authorization ?? '';",
            `            if (url.searchParams.get('access_token') !== ${JSON.stringify(SHARED_TOKEN)} && authorization !== ${JSON.stringify(`Bearer ${SHARED_TOKEN}`)}) {`,
            "                socket.close(1008, 'Unauthorized');",
            "                return;",
            "            }",
            "            connect(socket, request);",
            "        };",
            "    }",
            "}",
            "",
            "# kotori.toml",
            "[global]",
            `port = ${frameworkOrigin!.port || "7200"}`,
            "[adapter.onebots]",
            'extends = "onebots-adapter"',
            'mode = "ws-reverse"',
        ].join("\n"),
});

for (const profile of Object.values(BUILTIN_PROFILES)) {
    FrameworkIntegrationRegistry.register(
        profile.id === "zhin"
            ? zhinIntegration
            : profile.id === "astrbot"
              ? astrbotIntegration
              : profile.id === "langbot"
                ? langbotIntegration
                : profile.id === "alicebot"
                  ? alicebotIntegration
                  : profile.id === "kotori"
                    ? kotoriIntegration
                    : defineFrameworkIntegration({
                          profile,
                          renderFrameworkConfig: renderBuiltinFrameworkConfig,
                      }),
    );
}

for (const profile of ECOSYSTEM_PROFILES) {
    const entry = listFrameworkEcosystem().find(candidate => candidate.id === profile.id)!;
    FrameworkIntegrationRegistry.register(
        defineFrameworkIntegration({
            profile,
            ...(entry.runtime.transport === "reverse-websocket"
                ? {
                      resolveEndpoint: ({ frameworkOrigin }) =>
                          resolveReverseFrameworkEndpoint(
                              frameworkOrigin!,
                              entry.runtime.reversePath ?? "/onebot/v11/ws",
                          ),
                  }
                : profile.id === "avilla"
                  ? {
                        resolveEndpoint: ({ onebotsEndpoint }) =>
                            onebotsEndpoint.replace(/\/v1$/u, ""),
                    }
                  : {}),
            renderFrameworkConfig: context => renderEcosystemFrameworkConfig(context, entry),
        }),
    );
}

// 已验证方案统一以内置 Application 暴露兼容边界；`-t` 只负责选择并激活。
for (const profile of Object.values(BUILTIN_PROFILES)) {
    ApplicationRegistry.register(createProfileApplication(profile));
}

for (const profile of ECOSYSTEM_PROFILES) {
    ApplicationRegistry.register(createProfileApplication(profile));
}
