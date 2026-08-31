export type ManagementFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ManagementCredential {
    token?: string;
    session: boolean;
    error?: string;
}

export interface ManagementSessionRevocation {
    ok: boolean;
    status?: number;
    error?: string;
}

/** 复用网关实际优先级取得静态管理令牌，或通过用户名密码创建临时会话。 */
export async function acquireManagementCredential(
    base: string,
    config: Record<string, unknown>,
    fetcher: ManagementFetch = fetch,
): Promise<ManagementCredential> {
    const accessToken =
        stringConfigValue(process.env.ONEBOTS_ACCESS_TOKEN) ??
        stringConfigValue(config.access_token);
    if (accessToken) return { token: accessToken, session: false };

    const username = stringConfigValue(config.username);
    const password = stringConfigValue(config.password);
    if (!username || !password) return { session: false };
    try {
        const response = await fetcher(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password }),
            signal: AbortSignal.timeout(2_000),
        });
        const payload: unknown = await response.json();
        const token =
            isRecord(payload) && typeof payload.token === "string" ? payload.token.trim() : "";
        if (!response.ok || !token) {
            return { session: false, error: `管理登录失败: HTTP ${response.status}` };
        }
        return { token, session: true };
    } catch (error) {
        return {
            session: false,
            error: `管理登录不可达: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/** 撤销由命令或诊断临时创建的管理会话；静态 access token 不调用此边界。 */
export async function revokeManagementSession(
    base: string,
    token: string,
    fetcher: ManagementFetch = fetch,
): Promise<ManagementSessionRevocation> {
    try {
        const response = await fetcher(`${base}/api/auth/logout`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
        return { ok: response.ok, status: response.status };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function stringConfigValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
