import { types } from "node:util";
import type { Adapter } from "@onebots/core";

import type { ControlVerificationCommand } from "@onebots/core/control";
export type GatewayVerificationCommand = ControlVerificationCommand;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(input: unknown): Record<string, unknown> | undefined {
    if (!input || typeof input !== "object" || types.isProxy(input)) return;
    const prototype: unknown = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || key === "__proto__" || key === "toJSON") return;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return;
        result[key] = descriptor.value;
    }
    return result;
}
function exact(value: Record<string, unknown>, allowed: string[], required = allowed): boolean {
    return (
        Object.keys(value).every(key => allowed.includes(key)) &&
        required.every(key => Object.hasOwn(value, key))
    );
}
function bounded(value: unknown, limit: number): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        Buffer.byteLength(value) <= limit &&
        !/[\u0000-\u001f\u007f]/u.test(value)
    );
}
/** 不访问客户端 getter/Proxy，也不把答案保存在调用方可变对象上。 */
export function parseGatewayVerificationCommand(
    input: unknown,
): GatewayVerificationCommand | undefined {
    const value = record(input);
    if (
        !value ||
        !exact(
            value,
            ["operationId", "challengeId", "expected", "action", "data"],
            ["operationId", "challengeId", "expected", "action"],
        )
    )
        return;
    if (
        typeof value.operationId !== "string" ||
        !uuid.test(value.operationId) ||
        typeof value.challengeId !== "string" ||
        !uuid.test(value.challengeId)
    )
        return;
    const expected = record(value.expected);
    if (
        !expected ||
        !exact(expected, ["gatewayInstanceId", "configVersion"]) ||
        typeof expected.gatewayInstanceId !== "string" ||
        !uuid.test(expected.gatewayInstanceId) ||
        !bounded(expected.configVersion, 256)
    )
        return;
    if (value.action !== "submit" && value.action !== "request-sms") return;
    let data: Record<string, string> | undefined;
    if (Object.hasOwn(value, "data")) {
        const fields = record(value.data);
        if (!fields || Object.keys(fields).length > 32) return;
        data = Object.create(null);
        let bytes = 0;
        for (const key of Object.keys(fields).sort()) {
            const field = fields[key];
            if (!bounded(key, 128) || !bounded(field, 16384) || !field.trim()) return;
            bytes += Buffer.byteLength(key) + Buffer.byteLength(field);
            if (bytes > 32768) return;
            data![key] = field;
        }
    }
    return {
        operationId: value.operationId,
        challengeId: value.challengeId,
        expected: {
            gatewayInstanceId: expected.gatewayInstanceId,
            configVersion: expected.configVersion,
        },
        action: value.action,
        ...(data ? { data } : {}),
    };
}
export function isGatewayVerificationCommand(value: unknown): value is GatewayVerificationCommand {
    return parseGatewayVerificationCommand(value) !== undefined;
}
export function permitsVerificationInput(
    request: Adapter.VerificationRequest,
    command: GatewayVerificationCommand,
): boolean {
    const data = command.data ?? {};
    const keys = Object.keys(data);
    if (command.action === "request-sms")
        return request.requestSmsAvailable === true && keys.length === 0;
    if (
        keys.length === 1 &&
        keys[0] === "action" &&
        request.actions?.some(action => action.id === data.action)
    )
        return true;
    const inputs = request.options?.blocks?.filter(block => block.type === "input") ?? [];
    if (!keys.length) return inputs.length === 0 && request.confirmable === true;
    if (
        inputs.length === 0 ||
        new Set(inputs.map(input => input.key)).size !== inputs.length ||
        keys.length !== inputs.length
    )
        return false;
    return inputs.every(
        input =>
            Object.hasOwn(data, input.key) &&
            data[input.key].trim().length > 0 &&
            (input.maxLength === undefined || data[input.key].length <= input.maxLength),
    );
}
