import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BaseApp } from "@onebots/core";
import { loadPlugins } from "../runtime.js";
import { parseRuntimeConfig, validateRuntimeConfig } from "../runtime-config-validator.js";
import { GatewayApp } from "./app.js";
import {
    isGatewayParentMessage,
    type GatewayStartMessage,
    type GatewayChildMessage,
    type GatewayFailedMessage,
} from "./contracts.js";

let startMessage: GatewayStartMessage | undefined;
let app: GatewayApp | undefined;
let stopping = false;

function send(message: GatewayChildMessage): void {
    if (process.connected) process.send?.(message);
}

function failure(code: GatewayFailedMessage["code"], message: string): void {
    if (!startMessage) return;
    send({
        type: "gateway.failed",
        protocolVersion: 1,
        controlInstanceId: startMessage.controlInstanceId,
        gatewayInstanceId: startMessage.gatewayInstanceId,
        code,
        message,
    });
}

async function stop(timeoutMs = 15_000): Promise<void> {
    if (stopping) return;
    stopping = true;
    // 即使 SDK 留下活动句柄，也必须在截止时间前退出。
    setTimeout(() => process.exit(1), Math.min(timeoutMs, 30_000));
    try {
        await app?.stop();
        process.exit(0);
    } catch (error) {
        // 不序列化第三方错误：它可能包含平台凭据或请求头。
        failure("STOP_FAILED", "网关资源清理失败");
        process.stderr.write("[onebots] 网关资源清理失败\n");
        process.exit(1);
    }
}

async function start(message: GatewayStartMessage): Promise<void> {
    startMessage = message;
    try {
        const configPath = path.resolve(message.configPath);
        // 原账号数据库和会话仍保存在原工作区 data，不随配置版本移动。
        BaseApp.configDir = path.resolve(message.workspacePath);
        BaseApp.configFileName = path.relative(BaseApp.configDir, configPath);
        mkdirSync(BaseApp.dataDir, { recursive: true });
        const config = parseRuntimeConfig(readFileSync(configPath, "utf8"));
        delete config.username;
        delete config.password;
        delete config.access_token;
        const failures = await loadPlugins(
            message.selection.adapters,
            message.selection.protocols,
            message.selection.applications,
        );
        if (failures.length) throw new Error("网关扩展加载失败");
        if (stopping) return;
        validateRuntimeConfig(config);
        app = new GatewayApp(config);
        await app.start();
        if (stopping) return;
        const address = app.httpServer.address();
        if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
            throw new Error("网关未监听私有回环地址");
        }
        send({
            type: "gateway.ready",
            protocolVersion: 1,
            controlInstanceId: message.controlInstanceId,
            gatewayInstanceId: message.gatewayInstanceId,
            configVersion: message.configVersion,
            dependencyVersion: message.dependencyVersion,
            address: { host: "127.0.0.1", port: address.port },
        });
    } catch (error) {
        failure("START_FAILED", "网关启动失败，请检查配置与依赖版本");
        process.stderr.write("[onebots] 网关启动失败，请检查配置与依赖版本\n");
        // 父进程以退出码判定失败，不发布任何可能含凭据的错误对象。
        setTimeout(() => process.exit(1), 5_000);
        try {
            await app?.stop();
        } catch (error) {
            process.stderr.write("[onebots] 启动失败后的资源清理失败\n");
        }
        process.exit(1);
    }
}

if (!process.send || !process.connected) {
    process.stderr.write("[onebots] 网关只能由管理服务通过私有 IPC 启动\n");
    process.exit(1);
}

// 不从环境加载管理端或下载凭据。父进程仍应使用环境白名单创建网关。
for (const name of Object.keys(process.env)) {
    if (
        /^(?:ONEBOTS_ACCESS_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN)$/i.test(name) ||
        /^npm_config_.*(?:token|auth|password)/i.test(name)
    )
        delete process.env[name];
}
const handshakeTimer = setTimeout(() => process.exit(1), 30_000);
process.on("message", value => {
    if (!isGatewayParentMessage(value)) {
        failure("INVALID_MESSAGE", "网关 IPC 消息格式无效");
        return;
    }
    if (value.type === "gateway.start") {
        if (startMessage || stopping) return;
        clearTimeout(handshakeTimer);
        void start(value);
    } else if (
        startMessage &&
        value.controlInstanceId === startMessage.controlInstanceId &&
        value.gatewayInstanceId === startMessage.gatewayInstanceId
    ) {
        void stop(value.timeoutMs);
    }
});
process.once("disconnect", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
