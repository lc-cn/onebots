import type { Config as ICQQClientConfig } from "@icqqjs/icqq";
import type { ICQQConfig } from "./types.js";
import { invalidICQQParam } from "./errors.js";

export function parseICQQUin(accountId: string): number {
    return parseICQQNumericId(accountId, "account_id");
}

export function parseICQQNumericId(value: string, field: string): number {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw invalidICQQParam(`${field} 必须是正安全整数格式的 QQ 号`, value);
    }
    return result;
}

/** 将 OneBots 配置收敛为 ICQQ 客户端配置，并保留显式 false/0。 */
export function buildICQQClientConfig(config: ICQQConfig): ICQQClientConfig {
    const protocol = config.protocol ?? {};
    const result: ICQQClientConfig = {
        platform: (protocol.platform ?? 2) as ICQQClientConfig["platform"],
        sign_api_addr: protocol.sign_api_addr,
        data_dir: protocol.data_dir,
        ignore_self: protocol.ignore_self ?? true,
        resend: protocol.resend ?? true,
        reconn_interval: protocol.reconn_interval ?? 5,
        cache_group_member: protocol.cache_group_member ?? true,
        auto_server: protocol.auto_server ?? true,
    };
    if (protocol.ver) result.ver = protocol.ver;
    if (protocol.log_config) {
        result.log_config = protocol.log_config as ICQQClientConfig["log_config"];
    }
    if (protocol.ffmpeg_path) result.ffmpeg_path = protocol.ffmpeg_path;
    if (protocol.ffprobe_path) result.ffprobe_path = protocol.ffprobe_path;
    return result;
}
