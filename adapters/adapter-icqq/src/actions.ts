import type { Client } from "@icqqjs/icqq";
import { AccountStatus, Adapter, readPackageVersion, readPackageVersionFile } from "onebots";
import { ICQQGuildFileActions } from "./guild-file-actions.js";
import { executeICQQPlatformAction, ICQQ_PLATFORM_ACTIONS } from "./platform-actions.js";
import { invalidICQQParam } from "./errors.js";

/** 系统状态、版本与凭据动作；账号装配由最终适配器负责。 */
export abstract class ICQQActionAdapter extends ICQQGuildFileActions {
    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        if (!ICQQ_PLATFORM_ACTIONS.has(action)) {
            return super.executePlatformAction(uin, action, params);
        }
        return executeICQQPlatformAction(this.requireNativeClient(uin), action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return ICQQ_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(uin: string): Promise<Adapter.VersionInfo> {
        const client = this.requireNativeClient(uin);
        const [adapterVersion, icqqVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersionFile(new URL("../package.json", import.meta.resolve("@icqqjs/icqq"))),
        ]);
        return {
            app_name: "onebots ICQQ Adapter",
            app_version: adapterVersion,
            impl: "icqq",
            version: icqqVersion,
            impl_version: icqqVersion,
            qq_protocol_version: client.apk.ver,
            qq_protocol_type: milkyProtocolType(client.config.platform),
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        return {
            online: account?.status === AccountStatus.Online,
            good: account?.status === AccountStatus.Online,
        };
    }

    async getCookies(uin: string, params?: Adapter.GetCookiesParams): Promise<string> {
        const client = this.requireNativeClient(uin);
        const domain = params?.domain as Parameters<Client["getCookies"]>[0];
        return client.getCookies(domain);
    }

    async getCsrfToken(uin: string): Promise<number> {
        return this.requireNativeClient(uin).getCsrfToken();
    }

    async getCredentials(
        uin: string,
        params?: Adapter.GetCredentialsParams,
    ): Promise<Adapter.CredentialsInfo> {
        return {
            cookies: await this.getCookies(uin, params),
            csrf_token: await this.getCsrfToken(uin),
        };
    }

    async cleanCache(uin: string): Promise<void> {
        this.requireNativeClient(uin).cleanCache();
    }
}

function milkyProtocolType(platform: number): NonNullable<Adapter.VersionInfo["qq_protocol_type"]> {
    switch (platform) {
        case 1:
            return "android_phone";
        case 2:
            return "android_pad";
        case 3:
            return "watch";
        case 4:
            return "macos";
        case 5:
            return "ipad";
        case 6:
            return "windows";
        default:
            throw invalidICQQParam(`ICQQ 登录平台 ${platform} 无法投影为 Milky 协议类型`, {
                platform,
            });
    }
}
