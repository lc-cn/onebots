/**
 * MCP v1 stdio 传输
 *
 * 通过 stdin/stdout 提供 JSON-RPC 通信，供 Cursor / Claude Code 等 Agent 使用。
 * 用法: onebots mcp --config config.yaml --account qq/my-bot
 */
import * as readline from 'node:readline';
import { McpV1Protocol } from './index.js';

export interface StdioOptions {
    protocol: McpV1Protocol;
    onClose?: () => void;
}

export function startStdioTransport(options: StdioOptions): void {
    const { protocol, onClose } = options;
    let initialized = false;

    const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });

    const writeResponse = (data: string) => {
        process.stdout.write(data + '\n');
    };

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const response = await protocol.handleStdioMessage(trimmed);

        // 处理初始化
        if (!initialized) {
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed.method === 'initialize') {
                    initialized = true;
                }
            } catch {}
        }

        if (response !== null) {
            writeResponse(response);
        }
    });

    // 事件推送到 stdout
    const onDispatch = (event: any) => {
        if (!initialized) return;
        const notification = protocol.sendStdioNotification({
            method: 'notifications/message',
            params: event,
        });
        writeResponse(notification);
    };

    protocol.on('dispatch', onDispatch);

    rl.on('close', () => {
        protocol.off('dispatch', onDispatch);
        onClose?.();
    });

    process.stdin.on('end', () => {
        protocol.off('dispatch', onDispatch);
        onClose?.();
    });
}
