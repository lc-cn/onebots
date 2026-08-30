import type { Adapter, CommonTypes } from "onebots";
import type { SlackBot } from "./bot.js";
import { SlackError } from "./errors.js";

interface SlackFileRecord {
    id?: string;
    name?: string;
    title?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
    created?: number;
    user?: string;
}

/** 将 files.info 的平台模型闭合为 canonical FileInfo。 */
export async function getSlackFile(
    bot: SlackBot,
    fileId: string,
    createId: (value: string) => CommonTypes.Id,
): Promise<Adapter.FileInfo> {
    const response = (await bot.call("files.info", { file: fileId })) as {
        file?: SlackFileRecord;
    };
    const file = response.file;
    if (!file?.id) {
        throw SlackError.protocol("Slack 文件响应缺少 file", "SLACK_FILE_MISSING", response);
    }
    return {
        file_id: createId(file.id),
        file_name: file.name || file.title || file.id,
        file_size: file.size,
        url: file.url_private_download || file.url_private,
        uploaded_time: file.created,
        uploader_id: file.user ? createId(file.user) : undefined,
    };
}

export async function deleteSlackFile(bot: SlackBot, fileId: string): Promise<void> {
    await bot.call("files.delete", { file: fileId });
}
