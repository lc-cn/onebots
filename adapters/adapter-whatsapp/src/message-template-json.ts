import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppMessageTemplateComponent,
    WhatsAppTemplateJson,
} from "./message-template-types.js";

export function normalizeTemplateComponents(value: unknown): WhatsAppMessageTemplateComponent[] {
    return normalizeComponents(value, "parameter", value);
}

export function parseTemplateComponents(
    value: unknown,
    root: unknown,
): WhatsAppMessageTemplateComponent[] {
    return normalizeComponents(value, "response", root);
}

/** 规范化模板参数扩展面，同时拒绝循环、特殊原型和原型污染字段。 */
export function normalizeTemplateJsonRecord(
    value: unknown,
    name: string,
): Record<string, WhatsAppTemplateJson> {
    if (!isRecord(value)) fail("parameter", `${name} 必须是对象`, value);
    return jsonRecord(value, new Set(), "parameter", value);
}

type ValidationMode = "parameter" | "response";

function normalizeComponents(
    value: unknown,
    mode: ValidationMode,
    root: unknown,
): WhatsAppMessageTemplateComponent[] {
    if (!Array.isArray(value) || !value.length) fail(mode, "components 必须是非空数组", root);
    return value.map(item => component(item, mode, root));
}

function component(
    value: unknown,
    mode: ValidationMode,
    root: unknown,
): WhatsAppMessageTemplateComponent {
    if (!isRecord(value)) fail(mode, "每个模板组件必须是对象", root);
    const type = nonemptyString(value.type, "component.type", mode, root);
    return { ...jsonRecord(value, new Set(), mode, root), type };
}

function jsonRecord(
    value: Record<string, unknown>,
    stack: Set<object>,
    mode: ValidationMode,
    root: unknown,
): Record<string, WhatsAppTemplateJson> {
    if (!isPlainRecord(value)) fail(mode, "模板 JSON 对象必须使用普通原型", root);
    if (stack.has(value)) fail(mode, "模板 JSON 不能包含循环引用", root);
    stack.add(value);
    const result: Record<string, WhatsAppTemplateJson> = {};
    for (const [name, item] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(name)) {
            fail(mode, `模板 JSON 包含不安全字段: ${name}`, root);
        }
        result[name] = jsonValue(item, stack, mode, root);
    }
    stack.delete(value);
    return result;
}

function jsonValue(
    value: unknown,
    stack: Set<object>,
    mode: ValidationMode,
    root: unknown,
): WhatsAppTemplateJson {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
        if (stack.has(value)) fail(mode, "模板 JSON 不能包含循环引用", root);
        stack.add(value);
        const result = value.map(item => jsonValue(item, stack, mode, root));
        stack.delete(value);
        return result;
    }
    if (isRecord(value)) return jsonRecord(value, stack, mode, root);
    fail(mode, "模板组件只能包含可序列化 JSON 值", root);
}

function nonemptyString(value: unknown, name: string, mode: ValidationMode, root: unknown): string {
    if (typeof value !== "string" || !value.trim()) fail(mode, `${name} 必须是非空字符串`, root);
    return value;
}

function fail(mode: ValidationMode, message: string, details: unknown): never {
    throw new WhatsAppApiError(
        mode === "response" ? "WhatsApp 模板响应包含非法组件" : `WhatsApp ${message}`,
        {
            code: mode === "response" ? "WHATSAPP_INVALID_RESPONSE" : "WHATSAPP_INVALID_PARAMETER",
            details: mode === "response" ? details : undefined,
        },
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: Record<string, unknown>): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
