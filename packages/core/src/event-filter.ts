export type EventFilterMatch = "all" | "any";
export type EventFilterOperator =
    | "eq"
    | "neq"
    | "in"
    | "contains"
    | "regex"
    | "gt"
    | "gte"
    | "lt"
    | "lte";

export interface EventFilterRow {
    path: string;
    operator: EventFilterOperator;
    value: unknown;
}

export interface EventFilterEditorState {
    match: EventFilterMatch;
    rules: EventFilterRow[];
}

export type EventFilters = Record<string, unknown>;
export type EventFilterPredicate = (event: Record<string, unknown>) => boolean;

const operatorKeys: Record<string, EventFilterOperator> = {
    $like: "contains",
    $regex: "regex",
    $gt: "gt",
    $gte: "gte",
    $lt: "lt",
    $lte: "lte",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const asExpressions = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

const compare = (actual: unknown, operator: string, expected: unknown): boolean => {
    switch (operator) {
        case "$like":
            return typeof expected === "string" && String(actual).includes(expected);
        case "$regex":
            return typeof expected === "string" && new RegExp(expected).test(String(actual));
        case "$gt":
            return typeof expected === "number" && Number(actual) > expected;
        case "$gte":
            return typeof expected === "number" && Number(actual) >= expected;
        case "$lt":
            return typeof expected === "number" && Number(actual) < expected;
        case "$lte":
            return typeof expected === "number" && Number(actual) <= expected;
        case "$between":
            return (
                Array.isArray(expected) &&
                expected.length === 2 &&
                expected.every(item => typeof item === "number") &&
                Number(actual) >= expected[0] &&
                Number(actual) <= expected[1]
            );
        default:
            return false;
    }
};

const evaluateValue = (actual: unknown, expected: unknown): boolean => {
    if (Array.isArray(expected)) return expected.includes(actual);
    if (!isRecord(expected)) return actual === expected;

    return Object.entries(expected).every(([key, value]) => {
        if (key.startsWith("$")) return compare(actual, key, value);
        if (!isRecord(actual)) return false;
        return evaluateValue(actual[key], value);
    });
};

const evaluateExpression = (event: Record<string, unknown>, expression: unknown): boolean => {
    if (!isRecord(expression)) return false;

    return Object.entries(expression).every(([key, value]) => {
        switch (key) {
            case "$and":
                return asExpressions(value).every(item => evaluateExpression(event, item));
            case "$or":
                return asExpressions(value).some(item => evaluateExpression(event, item));
            case "$not":
                return !asExpressions(value).every(item => evaluateExpression(event, item));
            case "$nor":
                return !asExpressions(value).some(item => evaluateExpression(event, item));
            default:
                return evaluateValue(event[key], value);
        }
    });
};

/** 编译一次过滤配置，得到可复用的事件谓词。空配置匹配全部事件。 */
export const compileEventFilter = (filters?: EventFilters): EventFilterPredicate => {
    if (!filters || Object.keys(filters).length === 0) return () => true;
    return event => evaluateExpression(event, filters);
};

const nestPath = (path: string, value: unknown): Record<string, unknown> =>
    path
        .split(".")
        .filter(Boolean)
        .reverse()
        .reduce<Record<string, unknown>>(
            (nested, key, index) => ({
                [key]: index === 0 ? value : nested,
            }),
            {},
        );

const serializeRule = (rule: EventFilterRow): Record<string, unknown> => {
    let leaf: unknown;
    switch (rule.operator) {
        case "contains":
            leaf = { $like: rule.value };
            break;
        case "regex":
            leaf = { $regex: rule.value };
            break;
        case "gt":
        case "gte":
        case "lt":
        case "lte":
            leaf = { [`$${rule.operator}`]: rule.value };
            break;
        case "in":
            leaf = Array.isArray(rule.value) ? rule.value : [rule.value];
            break;
        default:
            leaf = rule.value;
    }
    const expression = nestPath(rule.path, leaf);
    return rule.operator === "neq" ? { $not: expression } : expression;
};

export const editorToEventFilters = (state: EventFilterEditorState): EventFilters => {
    const rules = state.rules
        .filter(rule => rule.path.trim() && rule.value !== "" && rule.value !== undefined)
        .map(serializeRule);
    if (!rules.length) return {};
    return { [state.match === "any" ? "$or" : "$and"]: rules };
};

const parseExpression = (
    expression: unknown,
    prefix: string[] = [],
    negated = false,
): EventFilterRow | null => {
    if (!isRecord(expression)) return null;
    const entries = Object.entries(expression);
    if (entries.length !== 1) return null;
    const [key, value] = entries[0];
    if (key === "$not") return parseExpression(value, prefix, true);
    if (key in operatorKeys) {
        if (!prefix.length) return null;
        return { path: prefix.join("."), operator: operatorKeys[key], value };
    }
    if (key.startsWith("$")) return null;
    if (isRecord(value)) return parseExpression(value, [...prefix, key], negated);
    return {
        path: [...prefix, key].join("."),
        operator: negated ? "neq" : Array.isArray(value) ? "in" : "eq",
        value,
    };
};

export const eventFiltersToEditor = (filters: unknown): EventFilterEditorState | null => {
    if (!isRecord(filters)) return null;
    if (!Object.keys(filters).length) return { match: "all", rules: [] };

    let match: EventFilterMatch = "all";
    let expressions: unknown[];
    if (Array.isArray(filters.$and)) {
        expressions = filters.$and;
    } else if (Array.isArray(filters.$or)) {
        match = "any";
        expressions = filters.$or;
    } else {
        expressions = Object.entries(filters).map(([key, value]) => ({ [key]: value }));
    }
    const rules = expressions.map(expression => parseExpression(expression));
    if (rules.some(rule => rule === null)) return null;
    return { match, rules: rules as EventFilterRow[] };
};
