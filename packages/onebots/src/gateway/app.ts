import { BaseApp, listenHttpServer, type Adapter } from "@onebots/core";
import { GatewayMessageDebugStore } from "./message-debug-store.js";
import { GatewayVerificationStore } from "./verification-store.js";
import packageMetadata from "../../package.json" with { type: "json" };
import { mergeRuntimeConfigDefaults } from "../runtime-defaults.js";
import { join } from "node:path";
import {
    ChatHistoryStore,
    projectInboundChatMessage,
    projectOutboundChatMessage,
} from "../chat-history-store.js";

/** 只拥有平台和协议资源的真实宿主，无管理路由、管理凭据或管理 socket。 */
export class GatewayApp extends BaseApp {
    readonly messageDebug = new GatewayMessageDebugStore();
    readonly verification = new GatewayVerificationStore();
    readonly chatHistory?: ChatHistoryStore;
    private historyClosed = false;
    private readonly disconnects: Array<{ platform: string; accountId: string }> = [];

    drainDisconnects() {
        return this.disconnects.splice(0);
    }

    constructor(config: BaseApp.Config) {
        // 注册表只提供协议字段默认值，不加载旧管理宿主或创建账号。
        const runtimeConfig = mergeRuntimeConfigDefaults(config);
        delete runtimeConfig.username;
        delete runtimeConfig.password;
        delete runtimeConfig.access_token;
        super(runtimeConfig, { name: packageMetadata.name, version: packageMetadata.version });
        try {
            this.chatHistory = new ChatHistoryStore(join(this.dataDir, "chat-history.db"), error =>
                this.logger.error("聊天历史过期清理失败", error),
            );
        } catch (error) {
            this.logger.error("聊天历史存储不可用；网关仍可继续处理消息", error);
        }
    }

    protected override onAdapterCreated(adapter: Adapter): void {
        adapter.on("verification:request", (payload: Adapter.VerificationRequest) => {
            this.verification.record(payload);
        });
        adapter.on("verification:clear", (payload: Adapter.VerificationClear) => {
            this.verification.clear(payload);
        });
        adapter.on("connection:disconnected", (payload: unknown) => {
            try {
                if (!payload || typeof payload !== "object") return;
                const value = payload as { platform?: unknown; account_id?: unknown };
                if (
                    value.platform !== adapter.platform ||
                    typeof value.account_id !== "string" ||
                    !value.account_id ||
                    value.account_id.length > 512 ||
                    this.disconnects.some(
                        item =>
                            item.platform === value.platform && item.accountId === value.account_id,
                    )
                )
                    return;
                if (this.disconnects.length < 1000)
                    this.disconnects.push({
                        platform: String(value.platform),
                        accountId: value.account_id,
                    });
            } catch {
                this.logger.error("连接状态事件无效，已忽略");
            }
        });
        adapter.on(
            "message:dispatch",
            (payload: { platform: string; account_id: string; event: unknown }) => {
                this.messageDebug.recordInbound(
                    payload.platform,
                    payload.account_id,
                    payload.event,
                );
                try {
                    const chat = projectInboundChatMessage(
                        payload.platform,
                        payload.account_id,
                        payload.event,
                    );
                    if (chat) this.chatHistory?.append(chat);
                } catch (error) {
                    this.logger.error("入站聊天记录保存失败", error);
                }
            },
        );
        adapter.on(
            "message:sent",
            (payload: {
                platform: string;
                account_id: string;
                params: unknown;
                result: unknown;
            }) => {
                try {
                    const chat = projectOutboundChatMessage(
                        payload.platform,
                        payload.account_id,
                        payload.params,
                        payload.result,
                    );
                    if (chat) this.chatHistory?.append(chat);
                } catch (error) {
                    this.logger.error("发出聊天记录保存失败", error);
                }
            },
        );
        adapter.on(
            "message:protocol-dispatch",
            (payload: {
                platform: string;
                account_id: string;
                protocol: string;
                version: string;
                data: unknown;
            }) => {
                this.messageDebug.recordOutbound(
                    payload.platform,
                    payload.account_id,
                    payload.protocol,
                    payload.version,
                    payload.data,
                );
            },
        );
    }

    protected override listenHttpServer(signal?: AbortSignal): Promise<void> {
        return listenHttpServer(this.httpServer, { host: "127.0.0.1", port: 0 }, signal);
    }

    /** 管理传输就绪不代表账号登录或协议启动已完成。 */
    startManaged(): Promise<{ accountsSettled: Promise<void> }> {
        return this.startManagedRuntime();
    }

    /** 配置快照属于管理服务，网关不允许通过账号 API 回写。 */
    protected override assertAccountConfigSourceCurrent(): void {
        throw new Error("网关配置由管理服务管理，请通过控制接口提交配置");
    }

    override async reload(): Promise<void> {
        throw new Error("网关使用固定配置快照，请由管理服务切换实例");
    }

    override async stop(): Promise<void> {
        this.verification.close();
        try {
            await super.stop();
        } finally {
            if (!this.historyClosed) {
                this.historyClosed = true;
                this.chatHistory?.close();
            }
        }
    }
}
