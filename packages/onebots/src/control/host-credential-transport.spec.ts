import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { createLocalControlClient } from "../client/local-control.js";
import { startControlHost } from "./host.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("可信 HTTPS 代理能保存 Satori token，HTTP 和伪造声明仍拒绝且不获得本机权限", async () => {
    const workspace = fs.mkdtempSync("/tmp/ob-credential-");
    cleanups.push(async () => fs.rmSync(workspace, { recursive: true, force: true }));
    const runtimeRoot = path.join(workspace, "runtime");
    fs.mkdirSync(path.join(runtimeRoot, "node_modules/@onebots"), { recursive: true });
    for (const [name, directory] of [
        ["onebots", "packages/onebots"],
        ["@onebots/protocol-satori-v1", "protocols/satori-v1/protocol"],
    ])
        fs.symlinkSync(
            path.resolve(directory),
            path.join(runtimeRoot, "node_modules", name),
            "dir",
        );
    fs.writeFileSync(
        path.join(workspace, "config.yaml"),
        JSON.stringify({
            plugins: { adapters: [], protocols: ["satori-v1"], applications: [] },
            general: { "satori.v1": { use_http: true, use_ws: true } },
        }),
    );
    const host = await startControlHost({
        workspace,
        runtimeRoot,
        port: 0,
        trustedProxyAddresses: ["192.0.2.20"],
    });
    cleanups.push(() => host.close());
    // 通过真实 HTTP 路由测试门禁；只替换代理 peer，避免依赖 CI 的外部网卡。
    let peer = "192.0.2.20";
    host.server.on("connection", socket => {
        Object.defineProperty(socket, "remoteAddress", { get: () => peer });
    });
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("测试管理入口不可用");
    const url = `http://127.0.0.1:${address.port}`;
    let token = "";
    const clientFor = (proto?: string) =>
        new ControlClient(
            createHttpControlTransport(
                url,
                () => token,
                (input, init) => {
                    const headers = new Headers(init?.headers);
                    if (proto) headers.set("X-Forwarded-Proto", proto);
                    return fetch(input, { ...init, headers });
                },
            ),
        );
    const client = clientFor();
    const code = (await createLocalControlClient(workspace).bootstrap()).code;
    ({ token } = await client.pair(code));
    const snapshot = await client.configurationSnapshot();
    const draft = await client.createConfigurationDraft(snapshot.base);
    const edit = {
        expectedRevision: draft.revision,
        changes: [],
        secrets: [
            {
                op: "set" as const,
                path: ["general", "satori.v1", "token"],
                value: "fake-fixture-token",
            },
        ],
    };
    await expect(client.editConfigurationDraft(draft.id, edit)).rejects.toMatchObject({
        status: 403,
    });
    const secure = clientFor("https");
    peer = "192.0.2.30";
    await expect(secure.editConfigurationDraft(draft.id, edit)).rejects.toMatchObject({
        status: 403,
    });
    peer = "192.0.2.20";
    const saved = await secure.editConfigurationDraft(draft.id, edit);
    expect(saved.secretStates).toContainEqual({
        path: ["general", "satori.v1", "token"],
        configured: true,
    });
    expect(JSON.stringify(saved)).not.toContain("fake-fixture-token");
    await expect(secure.bootstrap()).rejects.toMatchObject({ status: 403 });
});
