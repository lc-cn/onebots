export interface FrameworkAudit {
    sourceRevision: string;
    auditedAt: string;
    requiredActions: string[];
    supportedActions: string[];
    unsupportedActions: string[];
    note: string;
}

export interface FrameworkProfileView {
    id: string;
    displayName: string;
    kind: "framework" | "distribution";
    protocol: string;
    transport: string;
    verification: string;
    upstream: string;
    limitations: string[];
    distributionAudit?: FrameworkAudit;
}

export interface FrameworkPlanView {
    framework: FrameworkProfileView;
    endpoint: string;
    onebotsConfig: string;
    frameworkConfig: string;
    checks: Array<{ name: string; command?: string; expected: string }>;
    limitations: string[];
}

export function parseFrameworkCatalog(value: unknown): FrameworkProfileView[] {
    const root = record(value, "框架目录");
    if (root.schemaVersion !== 1 || !Array.isArray(root.frameworks)) {
        throw new TypeError("框架目录版本无效");
    }
    return root.frameworks.map(parseProfile);
}

export function parseFrameworkPlan(value: unknown): FrameworkPlanView {
    const root = record(value, "接入方案");
    return {
        framework: parseProfile(root.framework),
        endpoint: string(root.endpoint, "endpoint"),
        onebotsConfig: string(root.onebotsConfig, "onebotsConfig"),
        frameworkConfig: string(root.frameworkConfig, "frameworkConfig"),
        checks: array(root.checks, "checks").map(item => {
            const check = record(item, "check");
            return {
                name: string(check.name, "check.name"),
                ...(check.command === undefined
                    ? {}
                    : { command: string(check.command, "check.command") }),
                expected: string(check.expected, "check.expected"),
            };
        }),
        limitations: strings(root.limitations, "limitations"),
    };
}

function parseProfile(value: unknown): FrameworkProfileView {
    const profile = record(value, "framework");
    const kind = string(profile.kind, "kind");
    if (kind !== "framework" && kind !== "distribution") throw new TypeError("kind 无效");
    return {
        id: string(profile.id, "id"),
        displayName: string(profile.displayName, "displayName"),
        kind,
        protocol: string(profile.protocol, "protocol"),
        transport: string(profile.transport, "transport"),
        verification: string(profile.verification, "verification"),
        upstream: string(profile.upstream, "upstream"),
        limitations: strings(profile.limitations, "limitations"),
        ...(profile.distributionAudit === undefined
            ? {}
            : { distributionAudit: parseAudit(profile.distributionAudit) }),
    };
}

function parseAudit(value: unknown): FrameworkAudit {
    const audit = record(value, "distributionAudit");
    return {
        sourceRevision: string(audit.sourceRevision, "sourceRevision"),
        auditedAt: string(audit.auditedAt, "auditedAt"),
        requiredActions: strings(audit.requiredActions, "requiredActions"),
        supportedActions: strings(audit.supportedActions, "supportedActions"),
        unsupportedActions: strings(audit.unsupportedActions, "unsupportedActions"),
        note: string(audit.note, "note"),
    };
}

function record(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${name} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
    if (typeof value !== "string") throw new TypeError(`${name} 必须是字符串`);
    return value;
}

function array(value: unknown, name: string): unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${name} 必须是数组`);
    return value;
}

function strings(value: unknown, name: string): string[] {
    return array(value, name).map(item => string(item, name));
}
