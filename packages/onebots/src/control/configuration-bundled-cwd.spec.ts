import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { expect, it } from "vitest";

it("已安装 bundle 从无依赖工作目录启动仍使用安装根规划及热应用", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-bundle-cwd-")));
    let child: ChildProcess | undefined;
    let exited: Promise<unknown[]> | undefined;
    let cleanupConfirmed = true;
    try {
        const bundle = path.join(root, "installed-onebots");
        const source = path.resolve(import.meta.dirname, "../..");
        fs.mkdirSync(bundle);
        fs.cpSync(path.join(source, "lib"), path.join(bundle, "lib"), { recursive: true });
        fs.copyFileSync(path.join(source, "package.json"), path.join(bundle, "package.json"));
        const modules = path.join(bundle, "node_modules");
        fs.mkdirSync(modules);
        fs.symlinkSync(bundle, path.join(modules, "onebots"), "dir");
        // 模拟已安装包的依赖布局，不用调用方 cwd 或显式 runtimeRoot 补救默认解析。
        for (const name of fs.readdirSync(path.join(source, "node_modules"))) {
            if (name.startsWith(".")) continue;
            if (name.startsWith("@")) {
                fs.mkdirSync(path.join(modules, name));
                for (const child of fs.readdirSync(path.join(source, "node_modules", name)))
                    fs.symlinkSync(
                        path.join(source, "node_modules", name, child),
                        path.join(modules, name, child),
                        "dir",
                    );
            } else
                fs.symlinkSync(
                    path.join(source, "node_modules", name),
                    path.join(modules, name),
                    "dir",
                );
        }
        for (const [name, location] of [
            ["adapter-mock", "adapters/adapter-mock"],
            ["protocol-onebot-v11", "protocols/onebot-v11/protocol"],
        ]) {
            const extension = path.resolve(import.meta.dirname, "../../../..", location!);
            const target = path.join(modules, "@onebots", name!);
            fs.mkdirSync(target);
            // 扩展也需具有真实安装语义：symlink会使peer解析回源码工作区而触发双宿主保护。
            fs.copyFileSync(
                path.join(extension, "package.json"),
                path.join(target, "package.json"),
            );
            fs.cpSync(path.join(extension, "lib"), path.join(target, "lib"), { recursive: true });
        }
        const workspace = path.join(root, "workspace");
        fs.mkdirSync(workspace);
        fs.writeFileSync(
            path.join(workspace, "config.yaml"),
            yaml.dump({
                plugins: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
                "mock.alpha": { "onebot.v11": { use_http: true } },
            }),
        );
        const url = (file: string) => JSON.stringify(pathToFileURL(file).href);
        // 独立 Node 进程使用构建产物，避免测试编译器重写安装包的 import.meta.dirname。
        const script = `
            import { startControlHost } from ${url(path.join(bundle, "lib/control/host.js"))};
            import { createLocalControlClient } from ${url(path.join(bundle, "lib/client/local-control.js"))};
            import { ControlClient, createHttpControlTransport } from ${url(path.resolve(import.meta.dirname, "../../../core/lib/control.js"))};
            const workspace = ${JSON.stringify(workspace)};
            let phase='host';
            let host;
            try {
                host = await startControlHost({ workspace, port: 0 });
                const address = host.server.address();
                let token = '';
                const client = new ControlClient(createHttpControlTransport('http://127.0.0.1:'+address.port,()=>token));
                phase='pair';
                ({token} = await client.pair((await createLocalControlClient(workspace).bootstrap()).code));
                phase='online';
                const deadline=Date.now()+5000;
                while ((await client.status()).accounts?.items[0]?.status !== 'online') {
                    if(Date.now()>deadline) throw new Error('mock account did not become online');
                    await new Promise(resolve=>setTimeout(resolve,50));
                }
                const instance=(await client.status()).gateway.instance.id;
                phase='draft';
                const draft=await client.createConfigurationDraft((await client.configurationSnapshot()).base);
                const edit=await client.editConfigurationDraft(draft.id,{expectedRevision:draft.revision,
                    changes:[{op:'set',path:['mock.alpha','onebot.v11','heartbeat_interval'],value:8000}],secrets:[]});
                const validation=await client.validateConfigurationDraft(draft.id,edit.revision);
                if(validation.impact?.mode!=='hot') throw new Error('registry planning lost installed extensions');
                phase='apply';
                const operation=await client.applyConfiguration('independent-cwd-hot',validation.receiptId);
                process.stdout.write(JSON.stringify({status:operation.status,mode:operation.executionMode,
                    sameInstance:(await client.status()).gateway.instance.id===instance}));
            } catch { process.stderr.write('FIXTURE_STAGE:'+phase); process.exitCode=1; }
            finally { await host?.close(); }
        `;
        const processUnderTest = spawn(process.execPath, ["--input-type=module", "-e", script], {
            // macOS 的 tmpdir 路径可超过 sockaddr_un 上限，工作区内调用允许相对 socket。
            // 工作区没有 node_modules，仍能验证默认解析与安装目录/caller cwd 的分离。
            cwd: workspace,
            stdio: ["ignore", "pipe", "pipe"],
        });
        child = processUnderTest;
        cleanupConfirmed = false;
        exited = new Promise(resolve =>
            processUnderTest.once("close", (code, signal) => resolve([code, signal])),
        );
        let spawnFailed = false;
        processUnderTest.on("error", () => {
            spawnFailed = true;
            cleanupConfirmed = true; // 没有成功创建进程，不可能派生网关。
        });
        let output = "";
        let diagnostic = "";
        processUnderTest.stdout.on("data", data => {
            output += String(data);
        });
        // 不外发未知库的原始错误；退出码与公开操作结果就是观察边界。
        processUnderTest.stderr.on("data", data => {
            diagnostic += String(data);
        });
        const timer = setTimeout(() => processUnderTest.kill("SIGKILL"), 25_000);
        try {
            const exit = (await exited)[0];
            // exit 0 只会发生在脚本 finally 的 host.close 已完成后。
            cleanupConfirmed = cleanupConfirmed || exit === 0;
            expect(spawnFailed).toBe(false);
            const code = diagnostic.includes("ERR_MODULE_NOT_FOUND")
                ? "module-not-found"
                : "unclassified";
            // 仅暴露测试契约内的固定模块类别，不外发库返回的未知路径/模块名。
            const missing = diagnostic.includes("'onebots'") ? "onebots" : "unclassified";
            const stage =
                ["host", "pair", "online", "draft", "apply"].find(value =>
                    diagnostic.includes(`FIXTURE_STAGE:${value}`),
                ) ?? "unclassified";
            expect(exit, `${code}; missing=${missing}; stage=${stage}`).toBe(0);
            expect(JSON.parse(output)).toEqual({
                status: "succeeded",
                mode: "hot",
                sameInstance: true,
            });
        } finally {
            clearTimeout(timer);
        }
    } finally {
        if (child?.pid && child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        // manager 退出不等于其 detached 网关已退出；硬杀或失败时保留目录作对账证据。
        await exited;
        if (cleanupConfirmed) fs.rmSync(root, { recursive: true, force: true });
    }
}, 30_000);
