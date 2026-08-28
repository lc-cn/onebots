// App exports
export { App, createOnebots, defineConfig } from "./app.js";
export { getAppConfigSchema } from "./config-schema.js";

// Re-export core symbols that adapters and protocols depend on
// (avoids requiring consumers to add @onebots/core as a direct dependency)
export {
    // Registry
    AdapterRegistry,
    ProtocolRegistry,
    // Base classes
    Adapter,
    Account,
    Protocol,
    BaseApp,
    SqliteDB,
    Router,
    // Types
    CommonEvent,
    CommonTypes,
    AccountStatus,
    type Schema,
    type RouterContext,
    type Next,
    type Dict,
    type WsServer,
    type AdapterCapabilityManifest,
    // Infrastructure
    ConnectionManager,
    RetryPresets,
    // Utilities
    yaml,
    configure,
    readLine,
    dateLikeToEventMs,
    toUnixSeconds,
    unixSecondsToEventMs,
    unixMillisToEventMs,
    coerceUnixToEventMs,
    defineAdapterCapabilities,
    assertAdapterCapabilities,
    assertAdapterCapabilityContract,
    listSupportedActions,
    decryptWechatCallback,
    decryptWechatCallbackFor,
    extractWechatEncryptedPayload,
    parseWechatXml,
    verifyWechatCallbackSignature,
    // Proxy
    buildProxyUrl,
    maskProxyUrl,
    createProxyAgent,
    createHttpsProxyAgent,
    createSocksProxyAgent,
    // Auth
    createManagedTokenValidator,
    initTokenManager,
    // Config
    ConfigValidator,
} from "@onebots/core";
