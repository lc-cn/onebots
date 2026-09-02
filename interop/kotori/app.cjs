const fs = require("node:fs");
const http = require("node:http");
const { version: frameworkVersion } = require("kotori-bot/package.json");
const { OnebotAdapter } = require("@kotori-bot/kotori-plugin-adapter-onebot");
const {
    version: adapterVersion,
} = require("@kotori-bot/kotori-plugin-adapter-onebot/package.json");
const { WebSocketServer } = require("ws");

const port = Number(process.env.ONEBOTS_INTEROP_FRAMEWORK_PORT);
const token = process.env.ONEBOTS_INTEROP_TOKEN;
const evidenceFile = process.env.ONEBOTS_INTEROP_EVIDENCE;
const identity = "onebots";

class FixtureServer {
    constructor() {
        this.routes = new Map();
        this.server = http.createServer();
        this.webSocketServer = new WebSocketServer({ server: this.server });
        this.webSocketServer.on("connection", (socket, request) => {
            const pathname = new URL(request.url ?? "/", "ws://localhost").pathname;
            const handler = this.routes.get(pathname);
            if (!handler) {
                socket.close(1003, "Unknown adapter path");
                return;
            }
            handler(socket, request);
        });
    }

    wss(path, handler) {
        this.routes.set(path, handler);
        return () => this.routes.delete(path);
    }

    listen() {
        return new Promise(resolve => this.server.listen(port, "127.0.0.1", resolve));
    }

    close() {
        this.webSocketServer.close();
        this.server.close();
    }
}

const server = new FixtureServer();
let captureStarted = false;
const locale = value => value;
locale.bind = Function.prototype.bind.bind(locale);
const i18n = { locale, t: locale, extends: () => i18n };
const ctx = {
    config: { global: { port } },
    server,
    i18n,
    inject: () => undefined,
    emit: (name, payload) => {
        if (name !== "on_message" || captureStarted) return;
        captureStarted = true;
        void capture(payload);
    },
};

const adapter = new OnebotAdapter(ctx, { mode: "ws-reverse", lang: "en_US" }, identity);
const connect = adapter.connection.bind(adapter);
adapter.connection = (socket, request) => {
    const url = new URL(request.url ?? "/", "ws://localhost");
    const authorization = request.headers.authorization ?? "";
    if (url.searchParams.get("access_token") !== token && authorization !== `Bearer ${token}`) {
        socket.close(1008, "Unauthorized");
        return;
    }
    connect(socket, request);
};

async function capture(session) {
    const login = await adapter.api.getSelfInfo();
    const sent = await adapter.api.sendPrivateMsg("onebots-kotori-interop-reply", session.userId);
    const evidence = {
        framework: "kotori",
        frameworkVersion,
        adapterVersion,
        event: {
            type: session.type,
            plainText: session.message,
            messageId: session.messageId,
            userId: session.userId,
        },
        login,
        send: sent,
    };
    const temporary = `${evidenceFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(evidence), "utf8");
    fs.renameSync(temporary, evidenceFile);
}

async function main() {
    await server.listen();
    adapter.start();
}

process.on("SIGTERM", () => {
    adapter.stop();
    server.close();
    process.exit(0);
});

void main();
