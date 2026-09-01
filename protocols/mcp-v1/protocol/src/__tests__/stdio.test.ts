import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { startStdioTransport } from "../stdio.js";

describe("MCP stdio transport", () => {
    it("serializes requests and continues after an asynchronous handler failure", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const chunks: string[] = [];
        output.on("data", chunk => chunks.push(String(chunk)));
        const protocol = fakeProtocol();
        protocol.handleStdioMessage
            .mockRejectedValueOnce(new Error("tool failed"))
            .mockResolvedValueOnce('{"jsonrpc":"2.0","id":2,"result":{}}');
        const onError = vi.fn();

        startStdioTransport({ protocol, input, output, onError });
        input.write('{"jsonrpc":"2.0","id":1,"method":"tools/call"}\n');
        input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
        await settle();

        expect(protocol.handleStdioMessage.mock.calls.map(call => call[0])).toEqual([
            '{"jsonrpc":"2.0","id":1,"method":"tools/call"}',
            '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
        ]);
        expect(chunks.join("")).toBe(
            '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"内部错误"}}\n' +
                '{"jsonrpc":"2.0","id":2,"result":{}}\n',
        );
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "tool failed" }));
    });

    it("does not answer a failed notification that has no request id", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const write = vi.spyOn(output, "write");
        const protocol = fakeProtocol();
        protocol.handleStdioMessage.mockRejectedValueOnce(new Error("notification failed"));

        startStdioTransport({ protocol, input, output, onError: vi.fn() });
        input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
        await settle();

        expect(write).not.toHaveBeenCalled();
    });

    it("waits for queued work and closes exactly once across end and readline close", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const protocol = fakeProtocol();
        let resolveRequest: ((value: string | null) => void) | undefined;
        protocol.handleStdioMessage.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    resolveRequest = resolve;
                }),
        );
        const onClose = vi.fn(async () => undefined);

        startStdioTransport({ protocol, input, output, onClose, onError: vi.fn() });
        input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
        input.end();
        await settle();
        expect(onClose).not.toHaveBeenCalled();

        resolveRequest?.('{"jsonrpc":"2.0","id":1,"result":{}}');
        await settle();
        expect(onClose).toHaveBeenCalledOnce();
        expect(protocol.listenerCount("dispatch")).toBe(0);
    });
});

function fakeProtocol() {
    const protocol = new EventEmitter() as EventEmitter & {
        handleStdioMessage: ReturnType<typeof vi.fn<(line: string) => Promise<string | null>>>;
        sendStdioNotification: ReturnType<
            typeof vi.fn<(notification: Record<string, unknown>) => string>
        >;
    };
    protocol.handleStdioMessage = vi.fn<(line: string) => Promise<string | null>>();
    protocol.sendStdioNotification = vi.fn((notification: Record<string, unknown>) =>
        JSON.stringify(notification),
    );
    return protocol;
}

async function settle(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}
