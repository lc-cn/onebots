import { App } from 'onebots';

declare module 'onebots' {
    namespace Protocol {
        interface Configs {
            'mcp.v1': import('./types.js').McpV1Config;
        }
    }
}

App.registerGeneral('mcp.v1', {});
