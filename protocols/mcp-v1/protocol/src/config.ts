import { registerProtocolDefaults } from 'onebots';

declare module 'onebots' {
    namespace Protocol {
        interface Configs {
            'mcp.v1': import('./types.js').McpV1Config;
        }
    }
}

registerProtocolDefaults('mcp.v1', {});
