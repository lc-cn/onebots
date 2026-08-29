import type { Client } from "@icqqjs/icqq";
import { AccountStatus, Adapter, readPackageVersion, readPackageVersionFile } from "onebots";
import { ICQQGuildFileActions } from "./guild-file-actions.js";
import { executeICQQPlatformAction, ICQQ_PLATFORM_ACTIONS } from "./platform-actions.js";

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

    async getVersion(_uin: string): Promise<Adapter.VersionInfo> {
        const [adapterVersion, icqqVersion] = await Promise.all([
            readPackageVersion(import.meta.url),
            readPackageVersionFile(
                new URL("../package.json", import.meta.resolve("@icqqjs/icqq")),
            ),
        ]);
        return {
            app_name: "onebots ICQQ Adapter",
            app_version: adapterVersion,
            impl: "icqq",
            version: icqqVersion,
            impl_version: icqqVersion,
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
