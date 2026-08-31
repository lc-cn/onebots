#!/usr/bin/env node
/**
 * 适配器脚手架：生成一个可直接编译运行的 adapters/adapter-<platform> 包骨架。
 *
 * 用法：
 *   pnpm create:adapter <platform> [--display "显示名称"] [--description "描述"]
 *
 * 示例：
 *   pnpm create:adapter matrix --display "Matrix" --description "支持 Matrix 协议的房间消息"
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
            flags[key] = value;
        } else {
            positional.push(arg);
        }
    }
    return { positional, flags };
}

function toPascalCase(name) {
    return name
        .split(/[-_]/)
        .filter(Boolean)
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join("");
}

function fail(message) {
    console.error(`[create-adapter] ${message}`);
    process.exit(1);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const platform = positional[0];

if (!platform) {
    fail("缺少平台名称。用法：pnpm create:adapter <platform> [--display \"显示名称\"] [--description \"描述\"]");
}
if (!/^[a-z][a-z0-9-]*$/.test(platform)) {
    fail(`平台名称 "${platform}" 不合法，只能使用小写字母、数字和连字符，且必须以字母开头（如 matrix、wechat-work）`);
}

const displayName = flags.display || toPascalCase(platform);
const description = flags.description || `onebots ${displayName} 适配器`;
const className = toPascalCase(platform);
const packageDir = path.join(repoRoot, "adapters", `adapter-${platform}`);

if (existsSync(packageDir)) {
    fail(`目录已存在：${path.relative(repoRoot, packageDir)}`);
}

function write(relPath, content) {
    const fullPath = path.join(packageDir, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------
write(
    "package.json",
    JSON.stringify(
        {
            name: `@onebots/adapter-${platform}`,
            version: "0.1.0",
            description,
            type: "module",
            main: "lib/index.js",
            types: "lib/index.d.ts",
            scripts: {
                build: "rm -f *.tsbuildinfo && tsc --project tsconfig.json && tsc-alias -p tsconfig.json",
                clean: "rm -rf lib *.tsbuildinfo",
            },
            keywords: ["onebots", platform, "adapter"],
            author: "",
            license: "MIT",
            publishConfig: {
                access: "public",
                registry: "https://registry.npmjs.org",
            },
            files: ["/lib/**/*.js", "/lib/**/*.d.ts"],
            devDependencies: {
                "@types/node": "^24.0.0",
                "tsc-alias": "latest",
                typescript: "catalog:",
            },
            peerDependencies: {
                onebots: "workspace:*",
            },
            dependencies: {},
            repository: {
                type: "git",
                url: "git+https://github.com/lc-cn/onebots.git",
            },
        },
        null,
        2,
    ) + "\n",
);

// ---------------------------------------------------------------------------
// tsconfig.json
// ---------------------------------------------------------------------------
write(
    "tsconfig.json",
    JSON.stringify(
        {
            compilerOptions: {
                target: "ESNext",
                module: "ESNext",
                moduleResolution: "node",
                esModuleInterop: true,
                skipLibCheck: true,
                strict: false,
                noImplicitAny: false,
                declaration: true,
                declarationMap: true,
                sourceMap: true,
                outDir: "lib",
                rootDir: "src",
                composite: true,
                baseUrl: ".",
                paths: { "@/*": ["./src/*"] },
            },
            include: ["src/**/*"],
            exclude: ["node_modules", "lib"],
        },
        null,
        2,
    ) + "\n",
);

// ---------------------------------------------------------------------------
// src/types.ts
// ---------------------------------------------------------------------------
write(
    "src/types.ts",
    `/**
 * ${displayName} 适配器类型定义
 */

/** ${displayName} 账号配置。account_id 为必填，会自动注入；下面按需补充平台特有字段。 */
export interface ${className}Config {
    account_id: string;
    /** TODO: 替换为真实平台凭据字段，例如 token / appId / secret */
    token: string;
}

/** TODO: 替换为真实平台的收到消息事件结构 */
export interface ${className}MessageEvent {
    id: string;
    /** 发送者 ID */
    sender_id: string;
    /** 发送者昵称 */
    sender_name: string;
    /** 消息文本内容 */
    content: string;
    /** 群聊场景下的群 ID，私聊则为空 */
    group_id?: string;
    group_name?: string;
    /** Unix 秒级时间戳 */
    timestamp: number;
}
`,
);

// ---------------------------------------------------------------------------
// src/bot.ts
// ---------------------------------------------------------------------------
write(
    "src/bot.ts",
    `/**
 * ${displayName} Bot 客户端
 *
 * 封装与 ${displayName} 平台的实际连接（HTTP/WebSocket/SDK 等），
 * 通过 EventEmitter 把平台原始事件交给 adapter.ts 转换为 CommonEvent。
 *
 * TODO: 替换为真实的平台 SDK / HTTP 客户端调用。
 */
import { EventEmitter } from "node:events";
import type { ${className}Config, ${className}MessageEvent } from "./types.js";

export class ${className}Bot extends EventEmitter {
    private config: ${className}Config;
    private isRunning = false;

    constructor(config: ${className}Config) {
        super();
        this.config = config;
    }

    async start(): Promise<void> {
        // TODO: 建立到平台的连接（登录、WebSocket 握手等）
        this.isRunning = true;
        this.emit("ready", { user_id: this.config.account_id, nickname: this.config.account_id });

        // 示例：接收到平台消息后转发给 adapter 层
        // this.emit('message', { id, sender_id, sender_name, content, group_id, timestamp } satisfies ${className}MessageEvent);
    }

    async stop(): Promise<void> {
        // TODO: 关闭连接、清理定时器等
        this.isRunning = false;
        this.emit("stopped");
    }

    async sendMessage(targetId: string, text: string, sceneType: "private" | "group"): Promise<{ message_id: string }> {
        // TODO: 调用平台 API 实际发送消息
        void targetId;
        void text;
        void sceneType;
        return { message_id: \`\${Date.now()}\` };
    }

    async getLoginInfo(): Promise<{ user_id: string; nickname: string }> {
        // TODO: 调用平台 API 获取当前登录账号信息
        return { user_id: this.config.account_id, nickname: this.config.account_id };
    }
}
`,
);

// ---------------------------------------------------------------------------
// src/adapter.ts
// ---------------------------------------------------------------------------
write(
    "src/adapter.ts",
    `/**
 * ${displayName} 适配器
 * 继承 Adapter 基类，实现 ${displayName} 平台功能。
 *
 * 只有 createAccount 是必须实现的；其余方法（sendMessage、getGroupList 等）
 * 按平台实际支持的能力选择性重写，未重写的方法调用时会抛出 "not implemented"。
 */
import { Account, AccountStatus, Adapter, BaseApp, CommonEvent, type CommonTypes } from "onebots";
import { ${className}Bot } from "./bot.js";
import type { ${className}Config, ${className}MessageEvent } from "./types.js";

export class ${className}Adapter extends Adapter<${className}Bot, "${platform}"> {
    constructor(app: BaseApp) {
        super(app, "${platform}");
        this.icon = ""; // TODO: 平台 Logo URL
    }

    // ============================================
    // 消息相关方法
    // ============================================

    async sendMessage(uin: string, params: Adapter.SendMessageParams): Promise<Adapter.SendMessageResult> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(\`Account \${uin} not found\`);

        const bot = account.client;
        const { scene_type, message } = params;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);

        const text = message
            .map(seg => (seg.type === "text" ? seg.data.text || "" : \`[\${seg.type}]\`))
            .join("");

        const result = await bot.sendMessage(sceneId.string, text, scene_type === "private" ? "private" : "group");
        return { message_id: this.createId(result.message_id) };
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const account = this.getAccount(uin);
        if (!account) throw new Error(\`Account \${uin} not found\`);

        const info = await account.client.getLoginInfo();
        return {
            user_id: this.createId(info.user_id),
            user_name: info.nickname,
        };
    }

    // ============================================
    // 账号生命周期
    // ============================================

    createAccount(config: Account.Config<"${platform}">): Account<"${platform}", ${className}Bot> {
        const botConfig = config as unknown as ${className}Config;
        const bot = new ${className}Bot(botConfig);
        const account = new Account<"${platform}", ${className}Bot>(this, bot, config);

        bot.on("ready", (user: { user_id: string; nickname: string }) => {
            this.logger.info(\`\${this.platform} Bot \${user.nickname} (\${user.user_id}) 已就绪\`);
            account.status = AccountStatus.Online;
            account.nickname = user.nickname;
        });

        bot.on("stopped", () => {
            account.status = AccountStatus.OffLine;
        });

        // 收到平台消息 -> 转换为 CommonEvent -> 派发到已启用的协议（OneBot V11/V12、Satori、Milky）
        bot.on("message", (event: ${className}MessageEvent) => {
            const messageSegments: CommonTypes.Segment[] = [{ type: "text", data: { text: event.content } }];

            const commonEvent: CommonEvent.Message = {
                id: this.createId(event.id),
                timestamp: event.timestamp * 1000,
                platform: "${platform}",
                bot_id: this.createId(botConfig.account_id),
                type: "message",
                message_type: event.group_id ? "group" : "private",
                sender: {
                    id: this.createId(event.sender_id),
                    name: event.sender_name,
                },
                message_id: this.createId(event.id),
                raw_message: event.content,
                message: messageSegments,
            };

            if (event.group_id) {
                commonEvent.group = {
                    id: this.createId(event.group_id),
                    name: event.group_name || "",
                };
            }

            account.dispatch(commonEvent);
        });

        account.on("start", async () => {
            try {
                await bot.start();
            } catch (error) {
                this.logger.error(\`启动 \${this.platform} Bot 失败:\`, error);
                account.status = AccountStatus.OffLine;
            }
        });

        account.on("stop", async () => {
            await bot.stop();
            account.status = AccountStatus.OffLine;
        });

        return account;
    }
}

// 让 Adapter.Configs["${platform}"] 具备正确的类型提示
declare module "onebots" {
    export namespace Adapter {
        export interface Configs {
            ${platform}: ${className}Config;
        }
    }
}
`,
);

// ---------------------------------------------------------------------------
// src/index.ts
// ---------------------------------------------------------------------------
write(
    "src/index.ts",
    `import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { ${className}Adapter } from "./adapter.js";

export type { ${className}Config, ${className}MessageEvent } from "./types.js";
export * from "./adapter.js";

/** ${displayName} 账号配置表单 schema（供 Web 控制台生成配置表单使用） */
const ${platform.replace(/-/g, "_")}Schema: Schema = {
    account_id: { type: "string", required: true, label: "账号标识" },
    token: { type: "string", required: true, label: "Token / 凭据" },
};

AdapterRegistry.registerSchema("${platform}", ${platform.replace(/-/g, "_")}Schema);

AdapterRegistry.register("${platform}", ${className}Adapter, {
    name: "${platform}",
    displayName: "${displayName}",
    description: ${JSON.stringify(description)},
    icon: "",
    homepage: "https://github.com/lc-cn/onebots",
    author: "",
});
`,
);

// ---------------------------------------------------------------------------
// src/__tests__/adapter.test.ts
// ---------------------------------------------------------------------------
write(
    "src/__tests__/adapter.test.ts",
    `import { describe, expect, test, vi } from "vitest";

// 与其他协议/适配器测试保持一致：mock "onebots" 的最小可用 stub，
// 避免真的连接数据库 / 启动 HTTP 服务器。
vi.mock("onebots", () => {
    class Adapter {
        accounts = new Map();
        icon = "";
        constructor(
            public app: unknown,
            public platform: string,
        ) {}
        get logger() {
            return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        }
        getAccount(uin: string) {
            return this.accounts.get(uin);
        }
        createId(id: string) {
            return { string: id, number: Number(id) || 0, source: id };
        }
        coerceId(id: unknown) {
            return typeof id === "object" ? id : this.createId(String(id));
        }
    }
    class Account {
        status = "offline";
        nickname = "";
        constructor(
            public adapter: unknown,
            public client: unknown,
            public config: unknown,
        ) {}
        on() {}
        dispatch() {}
    }
    return {
        Adapter,
        Account,
        AccountStatus: { Online: "online", OffLine: "offline", Pending: "pending" },
        AdapterRegistry: { registerSchema: vi.fn(), register: vi.fn() },
        CommonEvent: {},
    };
});

const { ${className}Adapter } = await import("../adapter.js");
const { ${className}Bot } = await import("../bot.js");

describe("${className}Adapter", () => {
    test("createAccount wires up a client and returns an Account", () => {
        const adapter = new ${className}Adapter({} as never);
        const account = adapter.createAccount({ account_id: "test-bot", token: "t" } as never);

        expect(account).toBeDefined();
        expect(account.client).toBeInstanceOf(${className}Bot);
    });

    test("sendMessage throws for an unknown account", async () => {
        const adapter = new ${className}Adapter({} as never);
        await expect(
            adapter.sendMessage("missing", {
                scene_type: "private",
                scene_id: "1",
                message: [{ type: "text", data: { text: "hi" } }],
            } as never),
        ).rejects.toThrow(/not found/);
    });
});
`,
);

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------
write(
    "README.md",
    `# @onebots/adapter-${platform}

${description}

## 开发状态

这是通过 \`pnpm create:adapter\` 生成的脚手架，以下内容需要你按平台实际情况补充（搜索代码中的 \`TODO\`）：

- \`src/types.ts\` — 账号配置字段、收到消息的事件结构
- \`src/bot.ts\` — 与平台的实际连接逻辑（HTTP / WebSocket / 官方 SDK）
- \`src/adapter.ts\` — 按平台支持的能力，重写 \`Adapter\` 基类中的方法（\`sendMessage\`、\`getGroupList\` 等），未重写的方法调用时会抛出 "not implemented"
- \`src/index.ts\` — 补充配置表单 schema（\`Schema\`）、适配器图标等元信息

## 本地开发

\`\`\`bash
pnpm --filter=@onebots/adapter-${platform} build
npx vitest run adapters/adapter-${platform}
\`\`\`

## 在配置文件中启用

\`\`\`yaml
${platform}.your_account_id:
  token: 'your_token'

  onebot.v11:
    access_token: 'your_access_token'
\`\`\`

参考：[适配器配置指南](../../docs/src/guide/adapter.md)
`,
);

console.log(`已生成适配器骨架：${path.relative(repoRoot, packageDir)}`);
console.log("");
console.log("下一步：");
console.log(`  1. 编辑 ${path.relative(repoRoot, packageDir)}/src/types.ts、bot.ts、adapter.ts 中标记的 TODO`);
console.log("  2. pnpm install   # 让 workspace 识别新包");
console.log(`  3. pnpm --filter=@onebots/adapter-${platform} build`);
console.log(`  4. npx vitest run adapters/adapter-${platform}`);
console.log(`  5. 在 config.yaml 中添加 ${platform}.<account_id> 配置节并联调`);
