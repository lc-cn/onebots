import { describe, expect, it } from "vitest";
import { Protocol } from "./protocol.js";

describe("协议公共 Schema", () => {
    it("事件过滤器直接提供 sub_type 字段", () => {
        expect(Protocol.FilterSchema.ui.eventFields).toContainEqual({
            path: "sub_type",
            label: "事件子类型",
        });
    });
});
