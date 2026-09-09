import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { Adapter } from "@onebots/core";

const MAX_CHALLENGES = 20;
const MAX_REQUEST_BYTES = 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface GatewayVerificationChallenge {
    id: string;
    createdAt: number;
    expiresAt: number;
    request: Adapter.VerificationRequest;
}

/** 只复制普通 JSON 数据；不调用访问器、代理 trap 或业务对象的 toJSON。 */
function snapshot(input: unknown): Json {
    const ancestors = new Set<object>();
    let bytes = 0;
    let nodes = 0;
    const charge = (value: string): void => {
        bytes += Buffer.byteLength(value, "utf8");
        if (bytes > MAX_REQUEST_BYTES) throw new Error("验证请求过大");
    };
    const visit = (value: unknown, depth: number): Json => {
        if (++nodes > 100_000 || depth > 128) throw new Error("验证请求结构过大");
        if (value === null) {
            charge("null");
            return null;
        }
        if (typeof value === "boolean" || typeof value === "string") {
            charge(JSON.stringify(value));
            return value;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            charge(JSON.stringify(value));
            return value;
        }
        if (typeof value !== "object" || value === null || types.isProxy(value)) {
            throw new Error("验证请求必须是普通 JSON 数据");
        }
        if (ancestors.has(value)) throw new Error("验证请求包含循环引用");
        const array = Array.isArray(value);
        const prototype: unknown = Object.getPrototypeOf(value);
        if (
            array
                ? prototype !== Array.prototype
                : prototype !== Object.prototype && prototype !== null
        ) {
            throw new Error("验证请求包含非普通对象");
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        for (const key of keys) {
            if (typeof key !== "string" || key === "toJSON") throw new Error("验证请求字段无效");
            const descriptor = descriptors[key];
            if (
                !("value" in descriptor) ||
                (!descriptor.enumerable && !(array && key === "length"))
            ) {
                throw new Error("验证请求包含访问器或隐藏字段");
            }
        }
        ancestors.add(value);
        charge(array ? "[]" : "{}");
        let result: Json;
        if (array) {
            const length: unknown = descriptors.length.value;
            if (typeof length !== "number" || length > 100_000 || keys.length !== length + 1) {
                throw new Error("验证请求包含稀疏数组或额外字段");
            }
            const output: Json[] = [];
            for (let index = 0; index < length; index++) {
                const descriptor = descriptors[String(index)];
                if (!descriptor) throw new Error("验证请求包含稀疏数组");
                if (index) charge(",");
                output.push(visit(descriptor.value, depth + 1));
            }
            result = output;
        } else {
            const output: JsonObject = Object.create(null);
            for (const [index, key] of (keys as string[]).entries()) {
                if (index) charge(",");
                charge(`${JSON.stringify(key)}:`);
                output[key] = visit(descriptors[key].value, depth + 1);
            }
            result = output;
        }
        ancestors.delete(value);
        return result;
    };
    return visit(input, 0);
}

function object(value: Json | undefined): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: Json | undefined): value is string {
    return typeof value === "string" && value.trim().length > 0;
}
function keys(value: JsonObject, allowed: string[]): boolean {
    return Object.keys(value).every(key => allowed.includes(key));
}
function optional(value: JsonObject, key: string, check: (value: Json) => boolean): boolean {
    return !Object.hasOwn(value, key) || check(value[key]);
}
function block(value: Json): boolean {
    if (!object(value) || !text(value.type)) return false;
    switch (value.type) {
        case "image":
            return (
                keys(value, ["type", "base64", "alt"]) &&
                text(value.base64) &&
                optional(value, "alt", item => typeof item === "string")
            );
        case "image_url":
            return (
                keys(value, ["type", "url", "alt"]) &&
                text(value.url) &&
                optional(value, "alt", item => typeof item === "string")
            );
        case "qrcode":
            return (
                keys(value, ["type", "content", "alt"]) &&
                text(value.content) &&
                optional(value, "alt", item => typeof item === "string")
            );
        case "link":
            return (
                keys(value, ["type", "url", "label"]) &&
                text(value.url) &&
                optional(value, "label", item => typeof item === "string")
            );
        case "text":
            return keys(value, ["type", "content"]) && typeof value.content === "string";
        case "input":
            return (
                keys(value, ["type", "key", "placeholder", "maxLength", "secret"]) &&
                text(value.key) &&
                optional(value, "placeholder", item => typeof item === "string") &&
                optional(
                    value,
                    "maxLength",
                    item => typeof item === "number" && Number.isSafeInteger(item) && item > 0,
                ) &&
                optional(value, "secret", item => typeof item === "boolean")
            );
        default:
            return false;
    }
}
function request(value: Json): boolean {
    if (
        !object(value) ||
        !keys(value, [
            "platform",
            "account_id",
            "type",
            "hint",
            "options",
            "requestSmsAvailable",
            "confirmable",
            "confirmLabel",
            "actions",
            "data",
            "request_id",
        ])
    )
        return false;
    return (
        [value.platform, value.account_id, value.type, value.hint].every(text) &&
        optional(
            value,
            "options",
            item =>
                object(item) &&
                keys(item, ["blocks"]) &&
                optional(item, "blocks", blocks => Array.isArray(blocks) && blocks.every(block)),
        ) &&
        optional(value, "requestSmsAvailable", item => typeof item === "boolean") &&
        optional(value, "confirmable", item => typeof item === "boolean") &&
        optional(value, "confirmLabel", text) &&
        optional(value, "request_id", text) &&
        optional(value, "data", object) &&
        optional(
            value,
            "actions",
            item =>
                Array.isArray(item) &&
                item.every(
                    action =>
                        object(action) &&
                        keys(action, ["id", "label", "variant"]) &&
                        text(action.id) &&
                        text(action.label) &&
                        optional(
                            action,
                            "variant",
                            variant => variant === "primary" || variant === "secondary",
                        ),
                ),
        )
    );
}

/** 内存挑战只保留适配器提示，不接收或保存用户提交的验证答案。 */
export class GatewayVerificationStore {
    private readonly challenges = new Map<string, GatewayVerificationChallenge>();
    private closed = false;

    constructor(private readonly now: () => number = Date.now) {}

    record(input: Adapter.VerificationRequest): void {
        if (this.closed) return;
        try {
            const data = snapshot(input);
            if (!request(data)) return;
            // 经无副作用复制及字段校验后，JSON 往返生成独立的普通对象。
            const cloned = JSON.parse(JSON.stringify(data)) as Adapter.VerificationRequest;
            const createdAt = this.now();
            const challenge = {
                id: randomUUID(),
                createdAt,
                expiresAt: createdAt + TTL_MS,
                request: cloned,
            };
            const key = JSON.stringify([cloned.platform, cloned.account_id, cloned.type]);
            this.expire();
            this.challenges.delete(key);
            this.challenges.set(key, challenge);
            if (this.challenges.size > MAX_CHALLENGES) {
                const oldest = this.challenges.keys().next();
                if (!oldest.done) this.challenges.delete(oldest.value);
            }
        } catch {
            // 验证旁路忽略坏 SDK 数据；不能中断账号事件分发，也不读取异常对象。
        }
    }

    clear(input: Adapter.VerificationClear): void {
        try {
            const value = snapshot(input);
            if (
                !object(value) ||
                !keys(value, ["platform", "account_id", "type"]) ||
                !text(value.platform) ||
                !text(value.account_id) ||
                !optional(value, "type", text)
            )
                return;
            for (const [key, challenge] of this.challenges) {
                if (
                    challenge.request.platform === value.platform &&
                    challenge.request.account_id === value.account_id &&
                    (!Object.hasOwn(value, "type") || challenge.request.type === value.type)
                )
                    this.challenges.delete(key);
            }
        } catch {
            // 与 record 相同：无效清理事件不得删除有效挑战或打断账号事件。
        }
    }

    list(): GatewayVerificationChallenge[] {
        this.expire();
        return structuredClone([...this.challenges.values()]);
    }

    get(id: string): GatewayVerificationChallenge | undefined {
        this.expire();
        const challenge = [...this.challenges.values()].find(item => item.id === id);
        return challenge && structuredClone(challenge);
    }

    complete(id: string): boolean {
        this.expire();
        for (const [key, challenge] of this.challenges) {
            if (challenge.id !== id) continue;
            this.challenges.delete(key);
            return true;
        }
        return false;
    }

    close(): void {
        this.closed = true;
        this.challenges.clear();
    }

    private expire(): void {
        const now = this.now();
        for (const [key, challenge] of this.challenges) {
            if (challenge.expiresAt <= now) this.challenges.delete(key);
        }
    }
}
