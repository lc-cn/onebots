import { stringifyQuery, type LocationQuery, type RouteLocationRaw } from "vue-router";

interface QueryTokenTarget {
    path: string;
    hash: string;
    query: LocationQuery;
}

interface QueryTokenDependencies {
    authenticate(token: string): Promise<{ ok: boolean }>;
    hasExistingSession(): boolean;
}

/** 验证 URL 鉴权码后再提交会话，并保证后续导航不再携带该秘密。 */
export async function resolveQueryTokenNavigation(
    target: QueryTokenTarget,
    dependencies: QueryTokenDependencies,
): Promise<RouteLocationRaw | null> {
    if (!("access_token" in target.query)) return null;

    const query = { ...target.query };
    const candidate = query.access_token;
    delete query.access_token;
    const cleanTarget: RouteLocationRaw = {
        path: target.path,
        query,
        hash: target.hash,
        replace: true,
    };
    const token = typeof candidate === "string" ? candidate.trim() : "";
    let reason = "invalid_token";

    if (token) {
        try {
            if ((await dependencies.authenticate(token)).ok) return cleanTarget;
        } catch {
            reason = "token_unavailable";
        }
    }

    if (dependencies.hasExistingSession()) return cleanTarget;
    return {
        path: "/login",
        query: {
            redirect: serializeTarget(target.path, query, target.hash),
            reason,
        },
        replace: true,
    };
}

function serializeTarget(path: string, query: LocationQuery, hash: string): string {
    const serializedQuery = stringifyQuery(query);
    return `${path}${serializedQuery ? `?${serializedQuery}` : ""}${hash}`;
}
