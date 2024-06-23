import { MessageElem, Sendable } from "@icqqjs/icqq";
import { OneBot } from "@/onebot";
import { shareMusic } from "./shareMusicCustom";
import IcqqAdapter from "@/adapters/icqq/index";

export async function processMessages(
    this: IcqqAdapter,
    uin: string,
    target_id: number,
    target_type: "group" | "private",
    list: Sendable,
) {
    let result: MessageElem[] = [];
    console.log(list);
    for (const item of [].concat(list).filter(Boolean)) {
        const { type, ...data } = item;
        switch (type) {
            case "node": {
                result.push({
                    type,
                    ...data,
                    user_id: data.user_id,
                    message: await processMessages.call(
                        this,
                        uin,
                        data.user_id,
                        "private",
                        data.message || [],
                    ),
                });
                break;
            }
            case "music": {
                if (String(item.platform) === "custom") {
                    item.platform = item["subtype"]; // gocq 的平台数据存储在 subtype 内，兼容 icqq 时要求前端必须发送 id 字段
                }
                await shareMusic.call(
                    this[target_type === "private" ? "pickFriend" : "pickGroup"](target_id),
                    {
                        type,
                        ...data,
                    },
                );
                break;
            }
            case "share": {
                await this[target_type === "private" ? "pickFriend" : "pickGroup"](
                    target_id,
                ).shareUrl(data);
                break;
            }
            case "video":
            case "audio":
            case "image": {
                if (data["file"]?.startsWith("base64://"))
                    data["file"] = Buffer.from(data["file"].slice(9), "base64");
                result.push({
                    type: type as any,
                    ...data,
                });
                break;
            }
            case "reply": {
                const oneBot = this.getOneBot(uin);
                const message_id = oneBot.V11.getStrByInt("message_id", data.id);
                const msg = await oneBot.internal.getMsg(message_id);
                result.push({
                    type: "quote",
                    ...msg,
                });
                break;
            }
            default: {
                result.push({
                    type: type as any,
                    ...data,
                });
            }
        }
    }
    return result;
}
