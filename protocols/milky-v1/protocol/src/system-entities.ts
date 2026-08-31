import type { Adapter } from "onebots";
import type { Milky } from "./types.js";

/** 将通用用户资料投影为 canonical Milky 资料卡。 */
export function projectMilkyUserProfile(info: Adapter.UserInfo): Milky.UserProfile {
    return {
        nickname: info.user_name,
        qid: info.qid ?? "",
        age: nonNegativeInteger(info.age, "age"),
        sex: info.sex ?? "unknown",
        remark: info.remark ?? "",
        bio: info.bio ?? "",
        level: nonNegativeInteger(info.level, "level"),
        country: info.country ?? "",
        city: info.city ?? info.area ?? "",
        school: info.school ?? "",
    };
}

/** 投影 Milky 必需的实现与 QQ 协议信息，不猜测缺失的平台值。 */
export function projectMilkyImplInfo(info: Adapter.VersionInfo): Milky.ImplInfo {
    return {
        impl_name: info.app_name ?? info.impl ?? "onebots",
        impl_version: info.app_version ?? info.impl_version ?? info.version ?? "unknown",
        qq_protocol_version: requireString(info.qq_protocol_version, "qq_protocol_version"),
        qq_protocol_type: requireProtocolType(info.qq_protocol_type),
        milky_version: "1.0",
    };
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (value === undefined) return 0;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非负整数`);
    }
    return value;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string") throw new TypeError(`Adapter 缺少 ${field}`);
    return value;
}

function requireProtocolType(value: unknown): Milky.ImplInfo["qq_protocol_type"] {
    if (
        value === "windows" ||
        value === "linux" ||
        value === "macos" ||
        value === "android_pad" ||
        value === "android_phone" ||
        value === "ipad" ||
        value === "iphone" ||
        value === "harmony" ||
        value === "watch"
    ) {
        return value;
    }
    throw new TypeError("Adapter 缺少有效的 qq_protocol_type");
}
