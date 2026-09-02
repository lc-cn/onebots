import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeRoot = path.resolve(process.env.ONEBOTS_INTEROP_ZHIN_RUNTIME ?? "interop/zhin");
const evidencePath = process.env.ONEBOTS_INTEROP_EVIDENCE;
const endpointUrl = process.env.ONEBOTS_INTEROP_ENDPOINT;
const token = process.env.ONEBOTS_INTEROP_TOKEN;
if (!evidencePath || !endpointUrl || !token) throw new Error("Zhin 互操作环境变量不完整");

const adapterPackage = readJson("@zhin.js/adapter-onebot11/package.json");
const frameworkPackage = readJson("zhin.js/package.json");
const { OneBot11WsEndpoint } = await importPackage("@zhin.js/adapter-onebot11/lib/index.js");
const { bindEndpoint } = await importPackage("@zhin.js/adapter/lib/endpoint.js");

let endpoint;
const gateway = {
    async receive(event) {
        if (event.name !== "message.receive") return;
        const payload = event.payload;
        const login = await endpoint.client.call("get_login_info");
        const sentMessageId = await endpoint.send({
            conversation: payload.conversation,
            payload: [{ type: "text", data: { text: "onebots-zhin-interop-reply" } }],
        });
        writeEvidence({
            framework: "zhin",
            frameworkVersion: frameworkPackage.version,
            adapterVersion: adapterPackage.version,
            event: payload,
            login,
            send: { message_id: sentMessageId },
        });
    },
};

endpoint = new OneBot11WsEndpoint({
    id: "onebot11:interop",
    config: {
        context: "onebot11",
        id: "interop",
        connection: "ws",
        url: endpointUrl,
        access_token: token,
        reconnect_interval: 100,
        heartbeat_interval: 1_000,
    },
});
bindEndpoint(endpoint, {
    id: "onebot11:interop",
    name: "onebot11",
    config: {},
    use: () => gateway,
});
endpoint.open();
await endpoint.start();

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
        await endpoint.stop();
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
