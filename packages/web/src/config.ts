const DEFAULT_PORT = 6727;

export const isDev = import.meta.env.DEV;

const getEnvPort = () => {
    const value = import.meta.env.VITE_API_PORT;
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

export const getServerPort = () => {
    const stored = localStorage.getItem("onebots:serverPort");
    const storedPort = stored ? Number(stored) : undefined;
    if (storedPort && Number.isFinite(storedPort)) return storedPort;

    const envPort = getEnvPort();
    if (envPort) return envPort;

    return DEFAULT_PORT;
};

const getProtocol = () => window.location.protocol;

const RUNTIME_HTTP_PREFIX_META = "onebots-http-prefix";

/** 拒绝可把 Bearer 请求导向其他 origin 的畸形运行时元数据。 */
export const normalizeRuntimeHttpPrefix = (value: string | null | undefined) => {
    const configured = value?.trim() ?? "";
    if (!configured || configured === "/") return "";
    if (!configured.startsWith("/") || configured.startsWith("//")) return "";
    if (configured.includes("?") || configured.includes("#") || configured.includes("\\"))
        return "";
    if (/[\u0000-\u001f\u007f]/u.test(configured)) return "";
    const normalized = configured.replace(/\/+$/u, "");

    try {
        const valid = normalized
            .slice(1)
            .split("/")
            .every(segment => {
                const decoded = decodeURIComponent(segment);
                return (
                    decoded.length > 0 &&
                    decoded !== "." &&
                    decoded !== ".." &&
                    !/[/?#\\\u0000-\u001f\u007f]/u.test(decoded)
                );
            });
        return valid ? normalized : "";
    } catch {
        return "";
    }
};

export const joinApiUrl = (base: string, path: string) => {
    const normalizedBase = base.replace(/\/+$/u, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
};

const getRuntimeHttpPrefix = () => {
    if (typeof document === "undefined") return "";
    const value = document
        .querySelector(`meta[name="${RUNTIME_HTTP_PREFIX_META}"]`)
        ?.getAttribute("content");
    return normalizeRuntimeHttpPrefix(value);
};

export const resolveApiBaseUrl = (
    envBase: string | undefined,
    runtimePrefix: string,
    development: boolean,
) => {
    if (envBase) return envBase.replace(/\/+$/u, "");
    return development ? "" : normalizeRuntimeHttpPrefix(runtimePrefix);
};

/** 生产环境且未配置单独 API 地址时，使用同源（与页面同 host:port），避免 HF/Docker 等部署时仍请求 6727 */
export const getApiBaseUrl = () => {
    return resolveApiBaseUrl(import.meta.env.VITE_API_BASE, getRuntimeHttpPrefix(), isDev);
};

/** 生产环境且未配置单独 WS 地址时，使用当前页面的 origin（HF/Docker 等与页面同端口） */
export const getWsBaseUrl = () => {
    const envBase = import.meta.env.VITE_WS_BASE;
    if (envBase) return envBase;

    if (isDev) {
        const port = getServerPort();
        const wsProtocol = getProtocol() === "https:" ? "wss" : "ws";
        return `${wsProtocol}://${window.location.hostname}:${port}`;
    }
    const wsProtocol = getProtocol() === "https:" ? "wss" : "ws";
    return `${wsProtocol}://${window.location.host}`;
};

export const buildApiUrl = (path: string) => {
    return joinApiUrl(getApiBaseUrl(), path);
};

export const buildWsUrl = (path: string) => {
    const base = getWsBaseUrl();
    return `${base}${path}`;
};
