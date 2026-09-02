import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(process.env.ONEBOTS_INTEROP_KARIN_RUNTIME ?? "interop/karin");
const evidencePath = process.env.ONEBOTS_INTEROP_EVIDENCE;
const endpointUrl = process.env.ONEBOTS_INTEROP_ENDPOINT;
const token = process.env.ONEBOTS_INTEROP_TOKEN;
if (!evidencePath || !endpointUrl || !token) throw new Error("Karin 互操作环境变量不完整");

prepareKarinConfig();
const frameworkPackage = readJson("node-karin/package.json");
const adapterPackage = readJson("@karinjs/plugin-adapter-milky/package.json");
const karinModule = await importPackage("node-karin/dist/index.mjs");
const karin = karinModule.default;
karinModule.config.initConfigCache(path.join(process.cwd(), "@karinjs", "config"));

karinModule.hooks.message.friend(async (event, next) => {
    const send = await event.reply("onebots-karin-interop-reply");
    writeEvidence({
        framework: "karin",
        frameworkVersion: frameworkPackage.version,
        adapterVersion: adapterPackage.version,
        connection: {
            standard: event.bot.adapter.standard,
            communication: event.bot.adapter.communication,
            address: event.bot.adapter.address,
        },
        event: {
            event: event.event,
            subEvent: event.subEvent,
            userId: event.userId,
            rawMessage: event.rawMessage,
            elements: event.elements,
        },
        login: event.bot.account,
        send,
    });
    next();
});

await importPackage("@karinjs/plugin-adapter-milky/lib/index.js");

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        const bot = karin.getBot("mock:interop");
        bot?.stop();
        process.exit(0);
    });
}

function prepareKarinConfig() {
    const frameworkRoot = path.join(runtimeRoot, "node_modules", "node-karin");
    const configRoot = path.join(process.cwd(), "@karinjs", "config");
    fs.mkdirSync(configRoot, { recursive: true });
    fs.cpSync(path.join(frameworkRoot, "default", "config"), configRoot, { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), ".env"), "LOG_LEVEL=error\n", "utf8");

    const pluginConfig = path.join(
        process.cwd(),
        "@karinjs",
        "@karinjs",
        "plugin-adapter-milky",
        "config",
        "config.json",
    );
    fs.mkdirSync(path.dirname(pluginConfig), { recursive: true });
    fs.writeFileSync(
        pluginConfig,
        JSON.stringify({
            reconnectMaxCount: 0,
            reconnectInterval: 1,
            webhookToken: "interop-webhook-token",
            bots: [{ protocol: "websocket", url: endpointUrl, token }],
        }),
        { mode: 0o600 },
    );
}

function importPackage(packageName) {
    return import(pathToFileURL(path.join(runtimeRoot, "node_modules", packageName)).href);
}

function readJson(relativePath) {
    return JSON.parse(
        fs.readFileSync(path.join(runtimeRoot, "node_modules", relativePath), "utf8"),
    );
}

function writeEvidence(evidence) {
    const temporary = `${evidencePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(evidence), { mode: 0o600 });
    fs.renameSync(temporary, evidencePath);
}
