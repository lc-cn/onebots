import { describe, expect, it } from "vitest";
import { projectMilkyFriend } from "./friend-entities.js";

describe("Milky 好友实体投影", () => {
    it("保留性别、备注与好友分组", () => {
        expect(
            projectMilkyFriend({
                user_id: { string: "10001", number: 10001, source: 10001 },
                user_name: "Alice",
                sex: "female",
                remark: "A",
                category_id: 2,
                category_name: "朋友",
            }),
        ).toEqual({
            user_id: 10001,
            nickname: "Alice",
            sex: "female",
            qid: "",
            remark: "A",
            category: { category_id: 2, category_name: "朋友" },
        });
    });

    it("拒绝伪造缺失的好友分组", () => {
        expect(() =>
            projectMilkyFriend({
                user_id: { string: "10001", number: 10001, source: 10001 },
                user_name: "Alice",
            }),
        ).toThrow("category_id");
    });
});
