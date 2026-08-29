import { describe, expect, it } from "vitest";
import { projectMilkyImplInfo, projectMilkyUserProfile } from "./system-entities.js";

describe("Milky 系统实体投影", () => {
    it("输出完整用户资料卡且不泄漏通用 user_id", () => {
        expect(
            projectMilkyUserProfile({
                user_id: { string: "10001", number: 10001, source: 10001 },
                user_name: "Alice",
                qid: "alice",
                age: 21,
                sex: "female",
                remark: "A",
                bio: "OneBots",
                level: 42,
                area: "Manila",
            }),
        ).toEqual({
            nickname: "Alice",
            qid: "alice",
            age: 21,
            sex: "female",
            remark: "A",
            bio: "OneBots",
            level: 42,
            country: "",
            city: "Manila",
            school: "",
        });
    });

    it("输出完整 QQ 协议实现信息并拒绝猜测平台", () => {
        expect(
            projectMilkyImplInfo({
                app_name: "onebots ICQQ Adapter",
                app_version: "3.0.8",
                qq_protocol_version: "9.1.50",
                qq_protocol_type: "android_pad",
            }),
        ).toEqual({
            impl_name: "onebots ICQQ Adapter",
            impl_version: "3.0.8",
            qq_protocol_version: "9.1.50",
            qq_protocol_type: "android_pad",
            milky_version: "1.0",
        });
        expect(() => projectMilkyImplInfo({ app_name: "incomplete" })).toThrow(
            "qq_protocol_version",
        );
    });
});
