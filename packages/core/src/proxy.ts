/**
 * 统一代理 Agent 工厂
 * 消除各适配器中重复的代理 URL 构建和 Agent 创建逻辑
 */

/**
 * 代理配置
 */
export interface ProxyConfig {
    /** 代理服务器地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080 */
    url: string;
    /** 代理用户名（可选） */
    username?: string;
    /** 代理密码（可选） */
    password?: string;
}

/**
 * 构建包含认证信息的代理 URL
 * 使用 URL 对象确保正确编码用户名和密码中的特殊字符
 */
export function buildProxyUrl(proxy: ProxyConfig): string {
    const proxyUrl = new URL(proxy.url);
    if (proxy.username) proxyUrl.username = proxy.username;
    if (proxy.password) proxyUrl.password = proxy.password;
    return proxyUrl.toString();
}

/**
 * 脱敏代理 URL（用于日志输出）
 * 将密码部分替换为 ***
 */
export function maskProxyUrl(url: string): string {
    return url.replace(/:([^:@]+)@/, ':***@');
}

/**
 * 创建 HTTPS 代理 Agent
 * @param proxy 代理配置
 * @returns HttpsProxyAgent 实例，如果 https-proxy-agent 未安装则返回 null
 */
export async function createHttpsProxyAgent(proxy: ProxyConfig): Promise<InstanceType<any> | null> {
    if (!proxy?.url) return null;
    try {
        const proxyUrl = buildProxyUrl(proxy);
        // @ts-ignore - https-proxy-agent 是可选依赖
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        return new HttpsProxyAgent(proxyUrl);
    } catch {
        return null;
    }
}

/**
 * 创建 SOCKS5 代理 Agent
 * @param proxy 代理配置
 * @returns SocksProxyAgent 实例，如果 socks-proxy-agent 未安装则返回 null
 */
export async function createSocksProxyAgent(proxy: ProxyConfig): Promise<InstanceType<any> | null> {
    if (!proxy?.url) return null;
    try {
        const proxyUrl = buildProxyUrl(proxy);
        // 将 http/https scheme 转换为 socks5
        const socksUrl = proxyUrl.replace(/^https?:\/\//, 'socks5://');
        // @ts-ignore - socks-proxy-agent 是可选依赖
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        return new SocksProxyAgent(socksUrl);
    } catch {
        return null;
    }
}

/**
 * 创建代理 Agent（自动选择最佳可用代理类型）
 *
 * 策略：
 * 1. 如果 URL 以 socks 开头，优先使用 SocksProxyAgent
 * 2. 否则优先使用 HttpsProxyAgent
 * 3. 如果首选代理类型不可用，尝试回退
 * 4. 如果都不可用，返回 null（直连）
 *
 * @param proxy 代理配置
 * @param preferSocks 是否优先使用 SOCKS5（默认 false）
 * @returns 代理 Agent 实例，如果无可用代理则返回 null
 */
export async function createProxyAgent(
    proxy: ProxyConfig | undefined,
    preferSocks = false
): Promise<InstanceType<any> | null> {
    if (!proxy?.url) return null;

    const isSocksUrl = proxy.url.startsWith('socks');

    if (isSocksUrl || preferSocks) {
        // 尝试 SOCKS5 代理
        const socksAgent = await createSocksProxyAgent(proxy);
        if (socksAgent) return socksAgent;
        // 回退到 HTTPS 代理
        if (!isSocksUrl) {
            return createHttpsProxyAgent(proxy);
        }
        return null;
    }

    // 默认使用 HTTPS 代理
    return createHttpsProxyAgent(proxy);
}
