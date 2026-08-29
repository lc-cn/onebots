/**
 * ICQQ 适配器
 * 继承 Adapter 基类，实现 ICQQ 平台功能
 */
import { Account, AdapterRegistry, AccountStatus } from "onebots";
import { Adapter } from "onebots";
import { BaseApp } from "onebots";
import { ICQQBot } from "./bot.js";
import { icqqCapabilities } from "./capabilities.js";
import { type ICQQProjectionContext } from "./events.js";
import { wireICQQAccountEvents } from "./account-events.js";
import { ICQQActionAdapter } from "./actions.js";
import type { ICQQConfig } from "./types.js";

export class ICQQAdapter extends ICQQActionAdapter {
    constructor(app: BaseApp) {
        super(app);
    }

    // ============================================
    // 账号创建
    // ============================================

    createAccount(config: Account.Config<"icqq">): Account<"icqq", ICQQBot> {
        const icqqConfig: ICQQConfig = {
            account_id: config.account_id,
            password: config.password,
            protocol: config.protocol,
        };

        const bot = new ICQQBot(icqqConfig);
        const account = new Account<"icqq", ICQQBot>(this, bot, config);

        wireICQQAccountEvents(account, {
            logger: this.logger,
            emit: (event, payload) => this.emit(event, payload),
            projectionContext: accountId => this.projectionContext(accountId),
        });

        return account;
    }

    /**
     * Web 验证提交：将前端提交的滑块 ticket 或短信验证码转交给 ICQQ Bot
     * 支持 data.ticket / data.code（兼容）或通用 data.value；data.action=relogin 触发重新登录
     */
    override async submitVerification(
        accountId: string,
        type: string,
        data: Record<string, unknown>,
    ): Promise<void> {
        const account = this.getAccount(accountId);
        if (!account) {
            this.logger.warn(`submitVerification: 账号不存在 ${accountId}`);
            return;
        }
        const bot = account.client;
        const value = typeof data.value === "string" ? data.value : undefined;
        const action = typeof data.action === "string" ? data.action : undefined;

        if (action === "relogin" || type === "login_error" || type === "offline") {
            await this.setOnline(accountId);
            return;
        }

        if (type === "slider") {
            const ticket = (data.ticket ?? value) as string | undefined;
            if (typeof ticket === "string") bot.submitSlider(ticket);
        } else if (type === "sms") {
            const code = (data.code ?? value) as string | undefined;
            if (typeof code === "string") bot.submitSmsCode(code);
        } else if (type === "qrcode" || type === "auth" || type === "device") {
            // 扫码确认 / 身份验证 / 设备锁网页验证完成后需显式调用 login() 继续
            bot.continueLogin();
        } else {
            this.logger.debug(`submitVerification: 忽略类型 ${type} 或缺少参数`);
        }
    }

    /** 请求向密保手机发送短信验证码（设备锁时用户选短信验证前调用） */
    override requestSmsCode(accountId: string): Promise<void> {
        const account = this.getAccount(accountId);
        if (!account) {
            this.logger.warn(`requestSmsCode: 账号不存在 ${accountId}`);
            return Promise.resolve();
        }
        return account.client.sendSmsCode();
    }

    /** 重新登录：停止后再次 start，触发二维码/滑块等验证流程 */
    override async setOnline(uin: string): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) {
            throw new Error(`未找到账号 ${uin}`);
        }
        this.emit("verification:clear", {
            platform: "icqq",
            account_id: uin,
        } as Adapter.VerificationClear);
        account.status = AccountStatus.Pending;
        try {
            await account.client.stop();
        } catch (error) {
            this.logger.warn(`ICQQ 停止账号 ${uin} 时出错（将继续尝试登录）:`, error);
        }
        try {
            await account.client.start();
        } catch (error) {
            this.logger.error(`ICQQ 重新登录失败 ${uin}:`, error);
            account.status = AccountStatus.OffLine;
            throw error;
        }
    }

    override async setOffline(uin: string): Promise<void> {
        const account = this.getAccount(uin);
        if (!account) {
            throw new Error(`未找到账号 ${uin}`);
        }
        await account.client.stop();
        account.status = AccountStatus.OffLine;
        this.emit("verification:clear", {
            platform: "icqq",
            account_id: uin,
        } as Adapter.VerificationClear);
    }

    private projectionContext(accountId: string): ICQQProjectionContext {
        return {
            botId: this.createId(accountId),
            createId: value => this.createId(value),
        };
    }
}

declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            icqq: ICQQConfig;
        }
    }
}

AdapterRegistry.register("icqq", ICQQAdapter, {
    name: "icqq",
    displayName: "ICQQ 机器人",
    description: "基于 ICQQ 协议的 QQ 机器人适配器，支持扫码登录和密码登录",
    icon: "https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png",
    homepage: "https://github.com/icqqjs/icqq",
    author: "凉菜",
    capabilities: icqqCapabilities,
});
