import { V12 } from "@/service/V12";
import { version } from "@/utils";
import { OneBotStatus } from "@/onebot";
import { getProperties, toLine } from "@/utils";
import { Action } from "./";
import { createHash } from "crypto";
const sha = data => createHash("sha1").update(data).digest();
export class CommonAction {
    sendMessage() {}
    /**
     * 撤回消息
     * @param message_id {string} 消息id
     */
    deleteMessage(this: V12, message_id: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "deleteMsg", [message_id]);
    }

    /**
     * 获取消息详情
     */
    async getMessage(this: V12, message_id: string) {
        const message = await this.adapter.call(this.oneBot.uin, "V12", "getMessage", [message_id]);
        if (!message) throw new Error("消息不存在");
        return message;
    }
    getSelfInfo(this: V12) {
        return {
            user_id: this.oneBot.uin + "",
            platform: "qq",
            nickname: this.adapter.getSelfInfo(this.oneBot.uin, "V12").nickname,
            user_displayname: "",
        };
    }
    /**
     * 获取 Cookies
     * @param domain {string} 域名
     */
    async getCookies(this: V12, domain: string): Promise<string> {
        return await this.adapter.call(this.oneBot.uin, "V12", "getCookies", [domain]);
    }

    getStatus(this: V12) {
        return {
            good: this.oneBot.app.isStarted,
            bots: [
                {
                    self: this.action.getSelfInfo.apply(this),
                    good: this.oneBot.app.isStarted,
                },
            ],
        };
    }
    getLatestEvents(
        this: V12,
        limit: number = 0,
        timout: number = 0,
    ): Promise<V12.Payload<keyof Action>[]> {
        return new Promise(resolve => {
            if (!this.history.length && timout !== 0) {
                return setTimeout(
                    () => resolve(this.action.getLatestEvents.apply(this, [limit, timout])),
                    timout * 1000,
                );
            }
            return resolve(
                this.history.reverse().filter((_, i) => (limit === 0 ? true : i < limit)),
            );
        });
    }

    getVersion(this: V12) {
        return {
            impl: "onebots",
            platform: "qq",
            version,
            onebot_version: "12",
        };
    }
    async submitSlider(this: V12, ticket: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "callLogin", ["submitSlider", ticket]);
    }
    async submitSmsCode(this: V12, code: string) {
        return this.action.callLogin.apply(this, ["submitSmsCode", code]);
    }
    login(this: V12, password?: string): Promise<unknown> {
        return this.adapter.call(this.oneBot.uin, "V12", "callLogin", ["login", password]);
    }
    getSupportedActions(this: V12): string[] {
        return [...new Set(getProperties(this.action))]
            .filter(key => {
                return key !== "constructor";
            })
            .map(toLine);
    }
    uploadFile(
        this: V12,
        type: "url" | "path" | "data",
        name: string,
        url?: string,
        path?: string,
        data?: string,
        sha256?: string,
        headers?: Record<string, any>,
    ) {
        const fileInfo: V12.FileInfo = {
            name,
            url,
            type,
            path,
            data,
            sha256,
            headers,
        };
        return this.saveFile(fileInfo);
    }
    uploadFileFragmented(
        this: V12,
        stage: "prepare" | "transfer" | "finish",
        name?: string,
        total_size?: number,
        file_id?: string,
        offset?: number,
        data?: string,
        sha256?: string,
    ) {
        switch (stage) {
            case "prepare": {
                if (!name || !total_size) throw new Error("请输入name和total_size");
                return this.saveFile({
                    name,
                    type: "data",
                    total_size,
                    data: Buffer.alloc(0).toString("base64"),
                });
            }
            case "transfer": {
                if (!file_id || !offset || !data) throw new Error("请输入file_id、offset和data");
                const fileInfo = this.getFile(file_id);
                fileInfo.data = Buffer.concat([
                    Buffer.from(fileInfo.data),
                    Buffer.from(data),
                ]).toString("base64");
                return true;
            }
            case "finish": {
                if (!file_id || sha256) throw new Error("请输入file_id和sha256");
                const fileInfo = this.getFile(file_id);
                if (sha(Buffer.from(fileInfo.data)).toString("hex") === sha256) return file_id;
                this.delFile(file_id);
                throw new Error("文件已被篡改");
            }
        }
    }
    getFile(this: V12, file_id: string) {
        return this.getFile(file_id);
    }
    sendLike(this: V12, user_id: string, times: number = 1) {
        return this.adapter.call(this.oneBot.uin, "V12", "sendLike", [user_id, times]);
    }
    imageOcr(this: V12, file: string) {
        return this.adapter.call(this.oneBot.uin, "V12", "imageOcr", [file]);
    }
}
