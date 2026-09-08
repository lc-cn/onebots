import { BaseApp } from "@onebots/core";
import packageMetadata from "../../package.json" with { type: "json" };
import { mergeAppConfigDefaults } from "../app.js";

/** 只拥有平台和协议资源的真实宿主，无管理路由、管理凭据或管理 socket。 */
export class GatewayApp extends BaseApp {
    constructor(config: BaseApp.Config) {
        // 协议仍通过 App.registerGeneral 注册字段默认值；这不会创建账号或协议实例。
        const runtimeConfig = mergeAppConfigDefaults(config);
        delete runtimeConfig.username;
        delete runtimeConfig.password;
        delete runtimeConfig.access_token;
        super(runtimeConfig, { name: packageMetadata.name, version: packageMetadata.version });
    }

    protected override listenHttpServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.httpServer.once("error", reject);
            this.httpServer.listen({ host: "127.0.0.1", port: 0 }, () => {
                this.httpServer.removeListener("error", reject);
                resolve();
            });
        });
    }

    /** 配置快照属于管理服务，网关不允许通过账号 API 回写。 */
    protected override assertAccountConfigSourceCurrent(): void {
        throw new Error("网关配置由管理服务管理，请通过控制接口提交配置");
    }

    override async reload(): Promise<void> {
        throw new Error("网关使用固定配置快照，请由管理服务切换实例");
    }
}
