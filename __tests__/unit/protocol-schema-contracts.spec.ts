import { describe, expect, it } from "vitest";
import { assertSchemaFormContract } from "../../packages/core/src/config-validator.js";
import { ProtocolRegistry } from "../../packages/core/src/registry.js";
import "../../protocols/mcp-v1/protocol/src/index.js";
import "../../protocols/milky-v1/protocol/src/index.js";
import "../../protocols/onebot-v11/protocol/src/index.js";
import "../../protocols/onebot-v12/protocol/src/index.js";
import "../../protocols/satori-v1/protocol/src/index.js";

const protocols = ["mcp.v1", "milky.v1", "onebot.v11", "onebot.v12", "satori.v1"];

describe("protocol config schemas", () => {
    const schemas = ProtocolRegistry.getAllSchemas();

    it("所有协议都从包入口注册 Schema", () => {
        expect(Object.keys(schemas).sort()).toEqual(protocols);
    });

    it.each(Object.entries(schemas))("%s 的字段具备完整 Web 表单语义", (_, schema) => {
        expect(() => assertSchemaFormContract(schema)).not.toThrow();
    });
});
