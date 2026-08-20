import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { McpClient } from './client.js';
import type { McpStdioClientOptions } from './types.js';

export class McpStdioClient extends McpClient {
    private process: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private readonly command: string;
    private readonly args: string[];
    private readonly cwd?: string;
    private readonly env?: Record<string, string>;

    constructor(options: McpStdioClientOptions) {
        super(options);
        this.command = options.command;
        this.args = options.args ?? [];
        this.cwd = options.cwd;
        this.env = options.env;
    }

    async connect(): Promise<void> {
        this.process = spawn(this.command, this.args, {
            cwd: this.cwd,
            env: { ...process.env, ...this.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!this.process.stdout || !this.process.stdin) {
            throw new Error('无法建立 stdio 通道');
        }

        this.rl = readline.createInterface({ input: this.process.stdout, terminal: false });

        this.rl.on('line', (line) => {
            const trimmed = line.trim();
            if (trimmed) this.handleResponse(trimmed);
        });

        this.process.on('exit', (code) => {
            this.initialized = false;
            this.emit('close', code);
        });

        this.process.on('error', (err) => {
            this.emit('error', err);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            this.emit('stderr', data.toString());
        });

        await this.initialize();
    }

    protected send(data: string): void {
        this.process?.stdin?.write(data + '\n');
    }

    async close(): Promise<void> {
        this.rl?.close();
        this.process?.kill();
        this.process = null;
        this.initialized = false;
    }
}
