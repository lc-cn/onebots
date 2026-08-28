/**
 * 错误处理系统测试
 */

import { describe, it, expect } from "vitest";
import {
    OneBotsError,
    NetworkError,
    ConfigError,
    ValidationError,
    UnsupportedCapabilityError,
    ErrorHandler,
    ErrorCategory,
    ErrorSeverity,
} from "../errors.js";

describe("Error Handling System", () => {
    describe("OneBotsError", () => {
        it("should create error with default values", () => {
            const error = new OneBotsError("Test error");
            expect(error.message).toBe("Test error");
            expect(error.category).toBe(ErrorCategory.UNKNOWN);
            expect(error.severity).toBe(ErrorSeverity.MEDIUM);
            expect(error.code).toBe("UNKNOWN_ERROR");
        });

        it("should create error with custom options", () => {
            const error = new OneBotsError("Test error", {
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.HIGH,
                code: "CUSTOM_ERROR",
                context: { key: "value" },
            });
            expect(error.category).toBe(ErrorCategory.NETWORK);
            expect(error.severity).toBe(ErrorSeverity.HIGH);
            expect(error.code).toBe("CUSTOM_ERROR");
            expect(error.context).toEqual({ key: "value" });
        });

        it("should serialize to JSON", () => {
            const error = new OneBotsError("Test error", {
                category: ErrorCategory.CONFIG,
                context: { test: "value" },
            });
            const json = error.toJSON();
            expect(json.message).toBe("Test error");
            expect(json.category).toBe(ErrorCategory.CONFIG);
            expect(json.context).toEqual({ test: "value" });
            expect(json.timestamp).toBeDefined();
        });

        it("should convert to string", () => {
            const error = new OneBotsError("Test error", {
                category: ErrorCategory.NETWORK,
                code: "NET_ERROR",
            });
            expect(error.toString()).toBe("[NETWORK:NET_ERROR] Test error");
        });
    });

    describe("Specific Error Types", () => {
        it("should create NetworkError", () => {
            const error = new NetworkError("Connection failed");
            expect(error.category).toBe(ErrorCategory.NETWORK);
            expect(error.severity).toBe(ErrorSeverity.MEDIUM);
            expect(error.name).toBe("NetworkError");
        });

        it("should create ConfigError", () => {
            const error = new ConfigError("Invalid config");
            expect(error.category).toBe(ErrorCategory.CONFIG);
            expect(error.severity).toBe(ErrorSeverity.HIGH);
            expect(error.name).toBe("ConfigError");
        });

        it("should create ValidationError", () => {
            const error = new ValidationError("Validation failed");
            expect(error.category).toBe(ErrorCategory.VALIDATION);
            expect(error.severity).toBe(ErrorSeverity.MEDIUM);
            expect(error.name).toBe("ValidationError");
        });

        it("should expose structured adapter capability context", () => {
            const error = new UnsupportedCapabilityError({
                platform: "teams",
                capability: "get_message",
                reason: "platform_unsupported",
            });

            expect(error.code).toBe("ADAPTER_CAPABILITY_UNAVAILABLE");
            expect(error.reason).toBe("platform_unsupported");
            expect(error.context).toMatchObject({
                platform: "teams",
                capability: "get_message",
                reason: "platform_unsupported",
            });
        });
    });

    describe("ErrorHandler", () => {
        it("should wrap Error instance", () => {
            const originalError = new Error("Original error");
            const wrapped = ErrorHandler.wrap(originalError);
            expect(wrapped).toBeInstanceOf(OneBotsError);
            expect(wrapped.message).toBe("Original error");
            expect(wrapped.cause).toBe(originalError);
        });

        it("should wrap OneBotsError without modification", () => {
            const error = new NetworkError("Network error");
            const wrapped = ErrorHandler.wrap(error);
            expect(wrapped).toBe(error);
        });

        it("should wrap unknown error types", () => {
            const wrapped = ErrorHandler.wrap("String error");
            expect(wrapped).toBeInstanceOf(OneBotsError);
            expect(wrapped.message).toBe("String error");
        });

        it("should infer error category from message", () => {
            const networkError = ErrorHandler.wrap(new Error("Network timeout"));
            expect(networkError.category).toBe(ErrorCategory.NETWORK);

            const configError = ErrorHandler.wrap(new Error("Invalid configuration"));
            expect(configError.category).toBe(ErrorCategory.CONFIG);
        });

        it("should check if error is recoverable", () => {
            const recoverable = new OneBotsError("Test", {
                severity: ErrorSeverity.LOW,
            });
            expect(ErrorHandler.isRecoverable(recoverable)).toBe(true);

            const fatal = new OneBotsError("Test", {
                severity: ErrorSeverity.CRITICAL,
            });
            expect(ErrorHandler.isRecoverable(fatal)).toBe(false);
        });

        it("should check if error is fatal", () => {
            const fatal = new OneBotsError("Test", {
                severity: ErrorSeverity.CRITICAL,
            });
            expect(ErrorHandler.isFatal(fatal)).toBe(true);

            const nonFatal = new OneBotsError("Test", {
                severity: ErrorSeverity.LOW,
            });
            expect(ErrorHandler.isFatal(nonFatal)).toBe(false);
        });
    });
});
