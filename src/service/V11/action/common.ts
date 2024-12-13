import { OneBotStatus } from "@/onebot";
import { V11 } from "@/service/V11";
import { version } from "@/utils";

export class CommonAction {
    /**
     * 获取登录信息
     */
    getLoginInfo(this: V11) {
        return {
            user_id: this.oneBot.uin,
            nickname: this.adapter.getSelfInfo(this.oneBot.uin, "V11").nickname,
        };
    }

    /**
     * 撤回消息
     * @param message_id {string} 消息id
     */
    async deleteMsg(this: V11, message_id: number) {
        if (message_id == 0) throw new Error("getMsg: message_id[0] is invalid");
        const msg_id = this.getStrByInt("message_id", message_id);
        return this.adapter.call(this.oneBot.uin, "V11", "deleteMessage", [
            this.oneBot.uin,
            msg_id,
        ]);
    }

    /**
     * 获取消息
     * @param message_id {string} 消息id
     * @param onebot_id {number}
     */
    async getMsg(this: V11, message_id: number) {
        const msg_id = this.getStrByInt("message_id", message_id);
        let msg: V11.MessageRet = await this.adapter.call(this.oneBot.uin, "V11", "getMessage", [
            msg_id,
        ]);
        msg.message_id = message_id; // nonebot v11 要求 message_id 是 number 类型
        msg["real_id"] = msg.message_id; // nonebot 的reply类型会检测real_id是否存在，虽然它从未使用
        return msg;
    }

    /**
     * 获取合并消息
     * @param id {string} 合并id
     */
    getForwardMsg(this: V11, id: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "getForwardMsg", [id]);
    }

    /**
     * 获取 Cookies
     * @param domain {string} 域名
     */
    getCookies(this: V11, domain: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "getCookies", [domain])
    }

    /**
     * 获取 CSRF Token
     */
    getCsrfToken(this: V11) {
        return this.adapter.call(this.oneBot.uin, "V11", "getCsrfToken");
    }

    /**
     * 获取 QQ 相关接口凭证
     * @param domain
     */
    getCredentials(this: V11, domain: string) {
        return {
            cookies: this.adapter.call(this.oneBot.uin, "V11", "getCookies", [domain]),
            csrf_token: this.adapter.call(this.oneBot.uin, "V11", "getCsrfToken"),
        };
    }

    /**
     * 获取版本信息
     */
    getVersionInfo(this: V11) {
        return {
            app_name: "onebots",
            app_version: version,
            protocol_version: "v11",
        };
    }

    /**
     * 重启OneBot实现
     * @param delay {number} 要延迟的毫秒数
     */
    setRestart(this: V11, delay: number) {
        return this.emit("restart", delay);
    }

    getStatus(this: V11) {
        return {
            online: this.oneBot.status === OneBotStatus.Online,
            good: this.oneBot.app.isStarted,
        };
    }

    async submitSlider(this: V11, ticket: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "callLogin", ["submitSlider", ticket]);
    }

    async submitSmsCode(this: V11, code: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "callLogin", ["submitSmsCode", code]);
    }
    callApi(this: V11, name: string, args: any[]) {
        return this.adapter.call(this.oneBot.uin, "V11", "callApi", [name, args]);
    }
    login(this: V11, password?: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "callLogin", ["login", password]);
    }

    logout(this: V11, keepalive?: boolean) {
        return this.adapter.call(this.oneBot.uin, "V11", "logout", [keepalive]);
    }
    /**
     * 上传富媒体
     * @param this
     * @param target_id 目标id
     * @param target_type {group|user} 目标类型
     * @param file_data 文件base64或文件网络url
     * @param file_type {1|2|3} 文件类型 1：图片 2：视频 3：音频
     */
    async uploadMedia(
        this: V11,
        target_id: number,
        target_type: "group" | "user",
        file_data: string,
        file_type: 1 | 2 | 3,
    ) {
        const real_id = this.getStrByInt(`${target_type}_id`, target_id);
        return this.adapter.call(this.oneBot.uin, "V11", "uploadMedia", [
            real_id,
            target_type,
            file_data,
            file_type,
        ]);
    }

    getForumUrl(this: V11, guild_id: string, channel_id: string, forum_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "getForumUrl", [
            guild_id,
            channel_id,
            forum_id,
        ]);
    }
}
