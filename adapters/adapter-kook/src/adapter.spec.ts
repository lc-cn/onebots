import { describe, expect, test } from "vitest";
import { parseKookVoiceMembers } from "./adapter.js";

describe("KOOK Adapter responses", () => {
    test("按官方裸数组结构解析语音频道成员", () => {
        const users = [
            { id: "user-1", username: "Alice", nickname: "管理员", roles: [1, 2] },
            { id: "user-2", username: "Bob", online: true },
        ];

        expect(parseKookVoiceMembers(users)).toEqual(users);
    });

    test("拒绝误用标准分页 envelope 和缺少身份的成员", () => {
        expect(() => parseKookVoiceMembers({ items: [] })).toThrow("必须为数组");
        expect(() => parseKookVoiceMembers([{ id: "user-1" }])).toThrow("缺少用户身份");
    });
});
