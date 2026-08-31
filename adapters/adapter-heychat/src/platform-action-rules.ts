import type { HeychatActionParamRule } from "./platform-action-contract.js";

export const REQUIRED_STRING = {
    type: "string",
    required: true,
} satisfies HeychatActionParamRule;
export const OPTIONAL_STRING = { type: "string" } satisfies HeychatActionParamRule;
export const REQUIRED_INTEGER = {
    type: "integer",
    required: true,
} satisfies HeychatActionParamRule;
export const OPTIONAL_INTEGER = { type: "integer" } satisfies HeychatActionParamRule;
export const REQUIRED_BOOLEAN = {
    type: "boolean",
    required: true,
} satisfies HeychatActionParamRule;

export function integerEnum(values: readonly number[], required = false): HeychatActionParamRule {
    return { type: "integer", values, ...(required ? { required: true } : {}) };
}
