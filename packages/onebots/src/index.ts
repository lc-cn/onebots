// App exports
export { App, createOnebots, defineConfig } from './app.js';
export { getAppConfigSchema } from './config-schema.js';

// Re-export commonly used core symbols that adapters depend on
// (avoids requiring adapters to add @onebots/core as a direct dependency)
export {
    // Registry
    AdapterRegistry,
    ProtocolRegistry,
    // Types
    type Schema,
    type RouterContext,
    type Next,
    type Dict,
    type WsServer,
    // Base classes
    Adapter,
    Account,
    Protocol,
    BaseApp,
    // Infrastructure
    SqliteDB,
    Router,
    ConnectionManager,
    RetryPresets,
    // Utilities
    yaml,
    configure,
    readLine,
    // Auth
    createManagedTokenValidator,
    initTokenManager,
    // Config
    ConfigValidator,
} from '@onebots/core';
