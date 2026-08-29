import type { Adapter } from "onebots";
import type { Milky } from "./types.js";

/** 将通用群资料投影为 Milky 实体，不为缺失的必需元数据伪造默认值。 */
export function projectMilkyGroup(group: Adapter.GroupInfo): Milky.GroupInfo {
    return {
        group_id: positiveId(group.group_id.number, "group_id"),
        group_name: group.group_name,
        member_count: nonNegativeInteger(group.member_count, "member_count"),
        max_member_count: nonNegativeInteger(group.max_member_count, "max_member_count"),
        ...(group.remark === undefined ? {} : { remark: group.remark }),
        ...(group.created_time === undefined
            ? {}
            : { created_time: nonNegativeInteger(group.created_time, "created_time") }),
        ...(group.description === undefined ? {} : { description: group.description }),
        ...(group.question === undefined ? {} : { question: group.question }),
        ...(group.announcement === undefined ? {} : { announcement: group.announcement }),
    };
}

/** 将通用群成员资料投影为 Milky canonical GroupMemberEntity。 */
export function projectMilkyGroupMember(member: Adapter.GroupMemberInfo): Milky.GroupMemberInfo {
    return {
        user_id: positiveId(member.user_id.number, "user_id"),
        nickname: member.user_name,
        sex: member.sex ?? "unknown",
        group_id: positiveId(member.group_id.number, "group_id"),
        card: member.card ?? "",
        title: member.title ?? "",
        level: nonNegativeInteger(member.level, "level"),
        role: requireRole(member.role),
        join_time: nonNegativeInteger(member.join_time, "join_time"),
        last_sent_time: nonNegativeInteger(member.last_sent_time, "last_sent_time"),
        ...(member.shut_up_end_time === undefined
            ? {}
            : {
                  shut_up_end_time: nonNegativeInteger(member.shut_up_end_time, "shut_up_end_time"),
              }),
    };
}

function nonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`Adapter 返回的 ${field} 必须是非负整数`);
    }
    return value;
}

function positiveId(value: unknown, field: string): number {
    const id = nonNegativeInteger(value, field);
    if (id === 0) throw new TypeError(`Adapter 返回的 ${field} 必须是正整数 ID`);
    return id;
}

function requireRole(value: unknown): "owner" | "admin" | "member" {
    if (value !== "owner" && value !== "admin" && value !== "member") {
        throw new TypeError("Adapter 返回的 role 必须是 owner、admin 或 member");
    }
    return value;
}
