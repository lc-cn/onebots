import * as fs from "node:fs";
import * as path from "node:path";
import { App } from "@koishijs/core";
import { HTTP } from "@koishijs/plugin-http";
import { SatoriAdapter } from "@koishijs/plugin-adapter-satori";

const evidencePath = process.env.ONEBOTS_INTEROP_EVIDENCE;
const endpoint = process.env.ONEBOTS_INTEROP_ENDPOINT;
const token = process.env.ONEBOTS_INTEROP_TOKEN;
if (!evidencePath || !endpoint || !token) throw new Error("Koishi 互操作环境变量不完整");

const frameworkPackage = readJson("koishi/package.json");
const adapterPackage = readJson("@koishijs/plugin-adapter-satori/package.json");
const app = new App({ logLevel: 1 });
app.plugin(HTTP);
app.plugin(SatoriAdapter, { endpoint, token, retryTimes: 0 });
app.on("message", async session => {
    if (!session.content.includes("测试消息")) return;
    const event = {
        type: session.type,
        platform: session.platform,
        selfId: session.selfId,
        userId: session.userId,
        content: session.content,
    };
    const sent = await session.send("onebots-koishi-interop-reply");
    writeEvidence({
        framework: "koishi",
        frameworkVersion: frameworkPackage.version,
        adapterVersion: adapterPackage.version,
        bot: {
            platform: session.bot.platform,
            selfId: session.bot.selfId,
            status: session.bot.status,
        },
        event,
        send: sent,
    });
});
await app.start();

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
        await app.stop();
        process.exit(0);
    });
}

function readJson(relativePath) {
    return JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, "node_modules", relativePath), "utf8"),
    );
}

function writeEvidence(evidence) {
    const temporary = `${evidencePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(evidence), { mode: 0o600 });
    fs.renameSync(temporary, evidencePath);
}
