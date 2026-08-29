import { describe, expect, it } from "vitest";
import { projectMilkyGroup, projectMilkyGroupMember } from "./group-entities.js";

const id = (value: number) => ({ string: String(value), number: value, source: value });

describe("Milky 群实体投影", () => {
    it("保真投影 ICQQ 可提供的群与成员字段", () => {
        expect(
            projectMilkyGroup({
                group_id: id(20001),
                group_name: "OneBots",
                member_count: 20,
                max_member_count: 500,
                created_time: 100,
            }),
        ).toEqual({
            group_id: 20001,
            group_name: "OneBots",
            member_count: 20,
            max_member_count: 500,
            created_time: 100,
        });

        expect(
            projectMilkyGroupMember({
                group_id: id(20001),
                user_id: id(10001),
                user_name: "Alice",
                card: "管理员",
                sex: "female",
                level: 12,
                role: "admin",
                join_time: 100,
                last_sent_time: 200,
                title: "活跃成员",
                shut_up_end_time: 300,
            }),
        ).toEqual({
            user_id: 10001,
            nickname: "Alice",
            sex: "female",
            group_id: 20001,
            card: "管理员",
            title: "活跃成员",
            level: 12,
            role: "admin",
            join_time: 100,
            last_sent_time: 200,
            shut_up_end_time: 300,
        });
    });

    it("拒绝伪造缺失的 Milky 必需元数据", () => {
        expect(() => projectMilkyGroup({ group_id: id(20001), group_name: "OneBots" })).toThrow(
            "member_count",
        );
        expect(() =>
            projectMilkyGroupMember({
                group_id: id(20001),
                user_id: id(10001),
                user_name: "Alice",
            }),
        ).toThrow("level");
    });
});
