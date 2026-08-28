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

export interface EventFilterState {
    match: EventFilterMatch;
    rules: EventFilterRow[];
}

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

const nestPath = (path: string, value: unknown): Record<string, unknown> => {
    return path
        .split(".")
        .filter(Boolean)
        .reverse()
        .reduce<Record<string, unknown>>((nested, key, index) => ({
            [key]: index === 0 ? value : nested,
        }), {});
};

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

export const editorToFilters = (state: EventFilterState): Record<string, unknown> => {
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

export const filtersToEditor = (filters: unknown): EventFilterState | null => {
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
