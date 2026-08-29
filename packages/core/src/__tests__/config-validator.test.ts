/**
 * 配置验证系统测试
 */

import { describe, it, expect } from "vitest";
import { ConfigValidator, ValidationError } from "../config-validator.js";

describe("Config Validator", () => {
    describe("Basic Validation", () => {
        it("should validate required fields", () => {
            const schema = {
                name: { type: "string" as const, required: true },
                age: { type: "number" as const, required: true },
            };

            expect(() => {
                ConfigValidator.validate({}, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ name: "test", age: 20 }, schema);
            }).not.toThrow();
        });

        it("should apply default values", () => {
            const schema = {
                port: { type: "number" as const, default: 8080 },
                enabled: { type: "boolean" as const, default: true },
            };

            const result = ConfigValidator.validate({}, schema);
            expect((result as Record<string, unknown>).port).toBe(8080);
            expect((result as Record<string, unknown>).enabled).toBe(true);
        });

        it("should validate type", () => {
            const schema = {
                port: { type: "number" as const },
                name: { type: "string" as const },
                enabled: { type: "boolean" as const },
            };

            expect(() => {
                ConfigValidator.validate({ port: "8080" }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ port: 8080, name: "test", enabled: true }, schema);
            }).not.toThrow();
        });

        it("should validate number range", () => {
            const schema = {
                port: { type: "number" as const, min: 1, max: 65535 },
            };

            expect(() => {
                ConfigValidator.validate({ port: 0 }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ port: 70000 }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ port: 8080 }, schema);
            }).not.toThrow();
        });

        it("should validate string length", () => {
            const schema = {
                name: { type: "string" as const, min: 3, max: 10 },
            };

            expect(() => {
                ConfigValidator.validate({ name: "ab" }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ name: "abcdefghijklmnop" }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ name: "test" }, schema);
            }).not.toThrow();
        });

        it("should validate choices values", () => {
            const schema = {
                level: {
                    type: "string" as const,
                    choices: [
                        { value: "low", label: "低" },
                        { value: "medium", label: "中" },
                        { value: "high", label: "高" },
                    ],
                },
            };

            expect(() => {
                ConfigValidator.validate({ level: "invalid" }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ level: "medium" }, schema);
            }).not.toThrow();
        });

        it("should validate every value in a choices array", () => {
            const schema = {
                events: {
                    type: "array" as const,
                    choices: [
                        { value: "message", label: "消息" },
                        { value: "reaction", label: "反应" },
                    ],
                },
            };

            expect(() => {
                ConfigValidator.validate({ events: ["message", "reaction"] }, schema);
            }).not.toThrow();
            expect(() => {
                ConfigValidator.validate({ events: ["message", "unknown"] }, schema);
            }).toThrow(ValidationError);
        });

        it("should validate with pattern", () => {
            const schema = {
                email: { type: "string" as const, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
            };

            expect(() => {
                ConfigValidator.validate({ email: "invalid-email" }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ email: "test@example.com" }, schema);
            }).not.toThrow();
        });

        it("should use custom validator", () => {
            const schema = {
                password: {
                    type: "string" as const,
                    validator: (value: unknown) => {
                        if (String(value).length < 8) {
                            return "Password must be at least 8 characters";
                        }
                        return true;
                    },
                },
            };

            expect(() => {
                ConfigValidator.validate({ password: "short" }, schema);
            }).toThrow(ValidationError);

            expect(() => {
                ConfigValidator.validate({ password: "longpassword" }, schema);
            }).not.toThrow();
        });
    });

    describe("Nested Schema", () => {
        it("should validate nested objects", () => {
            const schema = {
                server: {
                    host: { type: "string" as const, required: true },
                    port: { type: "number" as const, default: 8080 },
                },
            };

            expect(() => {
                ConfigValidator.validate({ server: {} }, schema);
            }).toThrow(ValidationError);

            const result = ConfigValidator.validate({ server: { host: "localhost" } }, schema);
            const server = (result as Record<string, unknown>).server as Record<string, unknown>;
            expect(server.host).toBe("localhost");
            expect(server.port).toBe(8080);
        });
    });

    describe("Transform", () => {
        it("should transform values", () => {
            const schema = {
                port: {
                    type: "number" as const,
                    transform: (value: unknown) => parseInt(String(value), 10),
                },
            };

            const result = ConfigValidator.validate({ port: "8080" }, schema);
            expect((result as Record<string, unknown>).port).toBe(8080);
            expect(typeof (result as Record<string, unknown>).port).toBe("number");
        });
    });

    describe("validateWithDefaults", () => {
        it("should apply defaults to missing fields", () => {
            const schema = {
                port: { type: "number" as const, default: 8080 },
                host: { type: "string" as const, default: "localhost" },
            };

            const result = ConfigValidator.validateWithDefaults({}, schema);
            expect((result as Record<string, unknown>).port).toBe(8080);
            expect((result as Record<string, unknown>).host).toBe("localhost");
        });
    });
});
