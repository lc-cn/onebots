import { BaseApp, listenHttpServer, type Adapter } from "@onebots/core";
import { GatewayMessageDebugStore } from "./message-debug-store.js";
import { GatewayVerificationStore } from "./verification-store.js";
import packageMetadata from "../../package.json" with { type: "json" };
import { mergeRuntimeConfigDefaults } from "../runtime-defaults.js";

/** 只拥有平台和协议资源的真实宿主，无管理路由、管理凭据或管理 socket。 */
export class GatewayApp extends BaseApp {
    readonly messageDebug = new GatewayMessageDebugStore();
    readonly verification = new GatewayVerificationStore();

    constructor(config: BaseApp.Config) {
        // 注册表只提供协议字段默认值，不加载旧管理宿主或创建账号。
        const runtimeConfig = mergeRuntimeConfigDefaults(config);
        delete runtimeConfig.username;
        delete runtimeConfig.password;
        delete runtimeConfig.access_token;
        super(runtimeConfig, { name: packageMetadata.name, version: packageMetadata.version });
    }

    protected override onAdapterCreated(adapter: Adapter): void {
        adapter.on("verification:request", (payload: Adapter.VerificationRequest) => {
            this.verification.record(payload);
        });
        adapter.on("verification:clear", (payload: Adapter.VerificationClear) => {
            this.verification.clear(payload);
        });
        adapter.on(
            "message:dispatch",
            (payload: { platform: string; account_id: string; event: unknown }) => {
                this.messageDebug.recordInbound(
                    payload.platform,
                    payload.account_id,
                    payload.event,
                );
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

    /** 配置快照属于管理服务，网关不允许通过账号 API 回写。 */
    protected override assertAccountConfigSourceCurrent(): void {
        throw new Error("网关配置由管理服务管理，请通过控制接口提交配置");
    }

    override async reload(): Promise<void> {
        throw new Error("网关使用固定配置快照，请由管理服务切换实例");
    }

    override async stop(): Promise<void> {
        this.verification.close();
        await super.stop();
    }
}
