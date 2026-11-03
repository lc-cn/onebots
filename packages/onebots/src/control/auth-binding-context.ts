export interface AuthenticationBindingContext {
    authorityId: string;
    workspaceId: string;
    bindingRevision: number;
    operationId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validAuthenticationBindingContext(
    value: unknown,
): value is AuthenticationBindingContext {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const context = value as Record<string, unknown>;
    return (
        Object.keys(context).sort().join() ===
            "authorityId,bindingRevision,operationId,workspaceId" &&
        typeof context.authorityId === "string" &&
        UUID.test(context.authorityId) &&
        typeof context.workspaceId === "string" &&
        UUID.test(context.workspaceId) &&
        typeof context.operationId === "string" &&
        UUID.test(context.operationId) &&
        typeof context.bindingRevision === "number" &&
        Number.isSafeInteger(context.bindingRevision) &&
        context.bindingRevision > 0
    );
}

export function sameAuthenticationBindingContext(
    left: AuthenticationBindingContext,
    right: AuthenticationBindingContext,
): boolean {
    return (
        left.authorityId === right.authorityId &&
        left.workspaceId === right.workspaceId &&
        left.bindingRevision === right.bindingRevision &&
        left.operationId === right.operationId
    );
}
