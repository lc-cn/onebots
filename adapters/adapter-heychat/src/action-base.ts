import { Adapter, BaseApp, type Account, type CommonTypes } from "onebots";
import { HeychatBot } from "./bot.js";
import { heychatCapabilities } from "./capabilities.js";
import { HeychatApiError } from "./errors.js";

/** 标准动作共享的账号与平台 ID 边界。 */
export abstract class HeychatActionBase extends Adapter<HeychatBot, "heychat"> {
    constructor(app: BaseApp) {
        super(app, "heychat", heychatCapabilities);
        this.icon = "https://chat.xiaoheihe.cn/favicon.ico";
    }

    protected requireAccount(uin: string): Account<"heychat", HeychatBot> {
        const account = this.getAccount(uin);
        if (!account) {
            throw HeychatApiError.resource(
                `未找到黑盒语音账号 ${uin}`,
                "HEYCHAT_ACCOUNT_NOT_FOUND",
                { account_id: uin },
            );
        }
        return account;
    }

    protected requireBot(uin: string): HeychatBot {
        return this.requireAccount(uin).client;
    }

    protected toPlatformId(value: unknown): string {
        if (
            typeof value !== "string" &&
            typeof value !== "number" &&
            !(value && typeof value === "object" && "string" in value)
        ) {
            throw HeychatApiError.invalid(
                "黑盒语音 ID 必须是字符串、数字或统一 ID",
                "HEYCHAT_INVALID_ID",
                value,
            );
        }
        const resolved = this.resolveId(value as string | number | CommonTypes.Id);
        return String(resolved.source ?? resolved.string);
    }

    protected numericId(value: CommonTypes.Id): number {
        const id = Number(this.toPlatformId(value));
        if (!Number.isSafeInteger(id) || id < 0) {
            throw HeychatApiError.invalid(
                "黑盒语音用户 ID 必须是安全整数",
                "HEYCHAT_INVALID_ID",
                value,
            );
        }
        return id;
    }
}
