import { remove } from "@/utils";
import { Client, MessageElem, ShareElem } from "@icqqjs/icqq";
import { MusicElem } from "@icqqjs/icqq/lib/message";

export async function processMessage(
    this: Client,
    elements: MessageElem[],
): Promise<{ element: MessageElem[]; music?: MessageElem; share?: ShareElem }> {
    let music = elements.find(e => e.type === "music") as MusicElem;
    if (music) {
        remove(elements, music);
        if (String(music.platform) === "custom") {
            music.platform = music["subtype"]; // gocq 的平台数据存储在 subtype 内，兼容 icqq 时要求前端必须发送 id 字段
        }
    }
    let share = elements.find(e => e.type === "share") as ShareElem;
    if (share) remove(elements, share);
    for (const element of elements) {
        if (["image", "video", "audio"].includes(element.type)) {
            if (element["file_id"]?.startsWith("base64://"))
                element["file_id"] = Buffer.from(element["file_id"].slice(9), "base64");
            if (element["file"]?.startsWith("base64://"))
                element["file"] = Buffer.from(element["file"].slice(9), "base64");
        }
    }
    return { element: elements, share, music };
}
