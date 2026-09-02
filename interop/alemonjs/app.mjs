import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(
    process.env.ONEBOTS_INTEROP_ALEMONJS_RUNTIME ?? "interop/alemonjs",
);
const evidencePath = process.env.ONEBOTS_INTEROP_EVIDENCE;
const endpointUrl = process.env.ONEBOTS_INTEROP_ENDPOINT;
const token = process.env.ONEBOTS_INTEROP_TOKEN;
if (!evidencePath || !endpointUrl || !token) throw new Error("AlemonJS 互操作环境变量不完整");

globalThis.logger = {
    info: () => undefined,
    warn: () => undefined,
    error: (...args) => process.stderr.write(`${args.map(String).join(" ")}\n`),
};

const adapterPackage = readJson("@alemonjs/onebot/package.json");
const frameworkPackage = readJson("alemonjs/package.json");
const { OneBotClient } = await importPackage("@alemonjs/onebot/lib/sdk/wss.js");
const client = new OneBotClient({
    version: 11,
    url: endpointUrl,
    access_token: token,
    reverse_enable: false,
    reverse_port: 0,
});

client.on("DIRECT_MESSAGE", async event => {
    const login = await client.getLoginInfo();
    const sent = await client.sendPrivateMessage({
        user_id: event.user_id,
        message: [{ type: "text", data: { text: "onebots-alemonjs-interop-reply" } }],
    });
    writeEvidence({
        framework: "alemonjs",
        frameworkVersion: frameworkPackage.version,
        adapterVersion: adapterPackage.version,
        connection: client.getConnectionStatus(),
        event,
        login,
        send: sent,
    });
});
client.connect();

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        client.__ws?.close();
        process.exit(0);
    });
}

function importPackage(relativePath) {
    return import(pathToFileURL(path.join(runtimeRoot, "node_modules", relativePath)).href);
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
