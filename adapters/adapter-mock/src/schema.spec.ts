import { describe, expect, it } from "vitest";
import { mockSchema } from "./index.js";

describe("Mock 配置 Schema", () => {
    it("注册时满足通用表单契约并声明动态记录列表", () => {
        expect(mockSchema.friends).toMatchObject({
            type: "array",
            ui: { widget: "record-list" },
        });
        expect(mockSchema.groups).toMatchObject({
            type: "array",
            ui: { widget: "record-list" },
        });
    });
});
