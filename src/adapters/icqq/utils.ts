import { MessageElem } from "@icqqjs/icqq";
import { OneBot } from "@/onebot";
import { shareMusic } from "./shareMusicCustom";
import IcqqAdapter from "@/adapters/icqq/index";

export async function processMessages(
    this: IcqqAdapter,
    uin: string,
    target_id: number,
    target_type: "group" | "private",
    list: OneBot.Segment<OneBot.Version>[],
) {
    let result: MessageElem[] = [];
    for (const item of list) {
        const { type, data, ...other } = item;
        switch (type) {
            case "node": {
                const node = data || { ...other };
                result.push({
                    type,
                    ...node,
                    user_id: node.user_id,
                    message: await processMessages.call(
                        this,
                        uin,
                        node.user_id,
                        "private",
                        node.content || [],
                    ),
                });
                break;
            }
            case "music": {
                if (String(item.data.platform) === "custom") {
                    item.data.platform = item.data["subtype"]; // gocq 的平台数据存储在 subtype 内，兼容 icqq 时要求前端必须发送 id 字段
                }
                await shareMusic.call(
                    this[target_type === "private" ? "pickFriend" : "pickGroup"](target_id),
                    {
                        type,
                        ...(data || other),
                    },
                );
                break;
            }
            case "share": {
                await this[target_type === "private" ? "pickFriend" : "pickGroup"](
                    target_id,
                ).shareUrl({ ...(data || other) });
                break;
            }
            case "video":
            case "audio":
            case "image": {
                data["file"] = data["file"] || data["file_id"] || data["url"];
                if (data["file"]?.startsWith("base64://"))
                    data["file"] = Buffer.from(data["file"].slice(9), "base64");
                result.push({
                    type: type as any,
                    ...data,
                    ...other,
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
                    ...other,
                });
            }
        }
    }
    return result;
}
