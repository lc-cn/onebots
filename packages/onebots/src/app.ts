import { BaseApp, yaml, AdapterRegistry, ProtocolRegistry, configure, Protocol, Adapter } from "@onebots/core";
import path from "path";
import { createRequire } from "module";
import koaStatic from "koa-static";
import { copyFileSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { findPackageRoot } from "./utils.js";

const require = createRequire(import.meta.url);

export class App extends BaseApp { 
    constructor(config:App.Config){
        super(config);
        const clientRoot=findPackageRoot('@onebots/client');
        if(clientRoot){
            this.use(koaStatic(path.join(clientRoot,'dist')));
        }
    }
}
export namespace App {
    export interface Config extends BaseApp.Config { }
    export const defaultConfig: Config = {
        ...BaseApp.defaultConfig,
    }
    export function registerGeneral<K extends keyof Protocol.Configs>(
        key:K,
        config: Protocol.Config<Protocol.Configs[K]>,
    ) {
        defaultConfig.general = {
            ...defaultConfig.general,
            [key]: config
        }
    }
    export async function registerAdapter(platform: string)
    export async function registerAdapter(platform: string, factory: Adapter.Factory)
    export async function registerAdapter(platform: string, factory?: Adapter.Factory) {
        if (!factory) factory = await loadAdapterFactory(platform);
        AdapterRegistry.register(platform, factory);
    }
    export async function registerProtocol(name: string, version?: string)
    export async function registerProtocol(name: string, factory: Protocol.Factory, version?: string,)
    export async function registerProtocol(name: string, ...args: [Protocol.Factory, string?] | [string?]) {
        let factory: Protocol.Factory | undefined = typeof args[0] === "string" ? undefined : args[0];
        let version: string = typeof args[0] === "string" ? args[0] : args[1];
        if (!factory) factory = await loadProtocolFactory(name, version);
        ProtocolRegistry.register(name, version, factory);
    }
    export async function loadAdapterFactory(platform: string): Promise<Adapter.Factory> {
        const maybeNames = [
            `@onebots/adapter-${platform}`,
            `onebots-adapter-${platform}`,
            platform
        ];
        const errors:string[]=[];
        for (const name of maybeNames) {
            try {
                const entry = require.resolve(name);
                const mod = await import(entry);
                if (mod.default) return mod.default;
            } catch (e) {errors.push(e.toString());}
        }
        throw new Error(errors.join("\n"))
    }
    export async function loadProtocolFactory(name: string, version?: string): Promise<Protocol.Factory> {
        const fullName=[name,version].filter(Boolean).join("-");
        const maybeNames = [
            `@onebots/protocol-${fullName}`,
            `onebots-protocol-${fullName}`,
            `${fullName}`
        ];
        const errors:string[]=[];
        for (const modName of maybeNames) {
            try {
                const entry = require.resolve(modName);
                const mod = await import(entry);
                if (mod.default) return mod.default;
            } catch (e) {errors.push(e.toString());}
        }
        throw new Error(errors.join("\n"));
    }
}
export function createOnebots(
    config: BaseApp.Config | string = "config.yaml",
    // cp: ChildProcess | null = null,
) {
    const isStartWithConfigFile = typeof config === "string";
    if (isStartWithConfigFile) {
        config = path.resolve(process.cwd(), config as string);
        BaseApp.configDir = path.dirname(config);
    }
    if (!existsSync(BaseApp.configDir)) mkdirSync(BaseApp.configDir);
    if (!existsSync(BaseApp.configPath) && isStartWithConfigFile) {
        copyFileSync(path.resolve(__dirname, "../config.sample.yaml"), BaseApp.configPath);
        console.log("未找到对应配置文件，已自动生成默认配置文件，请修改配置文件后重新启动");
        console.log(`配置文件在:  ${BaseApp.configPath}`);
        process.exit();
    }
    if (!isStartWithConfigFile) {
        writeFileSync(BaseApp.configPath, yaml.dump(config));
        console.log(`已自动保存配置到：${BaseApp.configPath}`);
    }
    if (!existsSync(BaseApp.dataDir)) {
        mkdirSync(BaseApp.dataDir);
        console.log("已为你创建数据存储目录", BaseApp.dataDir);
    }
    config = yaml.load(readFileSync(BaseApp.configPath, "utf8")) as BaseApp.Config;
    configure({
        appenders: {
            out: {
                type: "stdout",
                layout: { type: "colored" },
            },
            files: {
                type: "file",
                maxLogSize: 1024 * 1024 * 50,
                filename: path.join(process.cwd(), "onebots.log"),
            },
        },
        categories: {
            default: {
                appenders: ["out", "files"],
                level: (config as BaseApp.Config).log_level || "info",
            },
        },
        disableClustering: true,
    });
    // if (cp) process.on("disconnect", () => cp.kill());
    return new App(config as BaseApp.Config);
}

export function defineConfig(config: BaseApp.Config) {
    return config;
}