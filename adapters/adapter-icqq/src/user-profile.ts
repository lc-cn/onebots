import type { Client } from "@icqqjs/icqq";
import type { ICQQUser } from "./types.js";

/** 聚合 ICQQ 简单资料与资料卡，避免协议层感知原生字段名。 */
export async function getICQQUserProfile(client: Client, userId: number): Promise<ICQQUser> {
    const [simple, rawProfile] = await Promise.all([
        client.getStrangerInfo(userId),
        client.pickUser(userId).getProfile(),
    ]);
    const profile = asRecord(rawProfile);
    const friend = client.fl.get(userId);

    return {
        user_id: simple.user_id,
        nickname: stringValue(profile.nickname) ?? simple.nickname,
        sex: genderValue(profile.sex) ?? simple.sex,
        age: integerValue(profile.age) ?? simple.age,
        qid: stringValue(profile.QID),
        remark: friend?.remark,
        bio: stringValue(profile.signature),
        level: integerValue(profile.level),
        area: simple.area,
        avatar: `https://q1.qlogo.cn/g?b=qq&nk=${simple.user_id}&s=640`,
    };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
}

function genderValue(value: unknown): ICQQUser["sex"] {
    return value === "male" || value === "female" || value === "unknown" ? value : undefined;
}
