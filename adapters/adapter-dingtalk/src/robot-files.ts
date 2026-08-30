import type { DingTalkBot } from "./bot.js";
import { DingTalkError } from "./errors.js";

const ROBOT_FILE_DOWNLOAD_PATH = "/v1.0/robot/messageFiles/download";

export interface DingTalkRobotFileDownloadResult {
    downloadUrl: string;
}

/**
 * 将机器人消息中的临时下载码兑换为下载地址。
 *
 * 下载码与接收消息的机器人绑定；默认使用账号配置的 Robot Code，命名平台动作可在
 * 多机器人托管场景显式传入事件携带的 robotCode。
 */
export async function getDingTalkRobotFileDownloadUrl(
    bot: DingTalkBot,
    downloadCode: string,
    robotCode = bot.config.robot_code || bot.config.app_key,
): Promise<DingTalkRobotFileDownloadResult> {
    if (!downloadCode.trim()) {
        throw DingTalkError.invalid(
            "钉钉机器人文件下载码不能为空",
            "DINGTALK_DOWNLOAD_CODE_REQUIRED",
        );
    }
    if (!robotCode?.trim()) {
        throw DingTalkError.config(
            "获取钉钉机器人文件必须配置 robot_code 或 app_key",
            "DINGTALK_ROBOT_CODE_REQUIRED",
        );
    }

    const response = await bot.callApi<unknown>(ROBOT_FILE_DOWNLOAD_PATH, {
        method: "POST",
        body: { downloadCode, robotCode },
    });
    const downloadUrl = readDownloadUrl(response);
    return { downloadUrl };
}

function readDownloadUrl(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidDownloadResponse(value);
    }
    const downloadUrl = Reflect.get(value, "downloadUrl");
    if (typeof downloadUrl !== "string" || !downloadUrl) {
        throw invalidDownloadResponse(value);
    }

    try {
        const url = new URL(downloadUrl);
        if (url.protocol !== "https:" || url.username || url.password) {
            throw new Error("downloadUrl 必须是无凭据 HTTPS URL");
        }
    } catch (error) {
        throw DingTalkError.protocol(
            "钉钉机器人文件接口返回了无效下载地址",
            "DINGTALK_DOWNLOAD_URL_INVALID",
            { response: value, cause: error instanceof Error ? error.message : String(error) },
        );
    }
    return downloadUrl;
}

function invalidDownloadResponse(value: unknown): DingTalkError {
    return DingTalkError.protocol(
        "钉钉机器人文件接口缺少 downloadUrl",
        "DINGTALK_DOWNLOAD_URL_MISSING",
        { response: value },
    );
}
