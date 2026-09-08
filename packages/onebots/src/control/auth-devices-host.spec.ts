import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";

let host: Awaited<ReturnType<typeof startControlHost>> | undefined;
let directory: string | undefined;
afterEach(async () => {
    await host?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

it("本机追加设备不挤掉旧设备，逐设备撤销跨重启保持，恢复撤销所有旧设备", async () => {
    directory = fs.mkdtempSync("/tmp/ob-devices-");
    host = await startControlHost({ workspace: directory, port: 0 });
    const client = (token = "") => {
        const address = host?.server.address();
        if (!address || typeof address === "string") throw new Error("missing listener");
        return new ControlClient(createHttpControlTransport(`http://127.0.0.1:${address.port}`, () => token));
    };
    const local = createLocalControlClient(directory);
    const first = await client().pair((await local.bootstrap()).code);
    await expect(client().authorizeDevice()).rejects.toThrow();
    await expect(client(first.token).authorizeDevice()).rejects.toThrow();
    const device = await local.authorizeDevice();
    const second = await client().pair(device.code);
    await expect(client().pair(device.code)).rejects.toThrow();
    await expect(client(first.token).status()).resolves.toHaveProperty("manager");
    await expect(client(second.token).status()).resolves.toHaveProperty("manager");
    await expect(local.sessions()).rejects.toThrow();
    const listed = await client(first.token).sessions();
    expect(listed.sessions).toHaveLength(2);
    expect(listed.sessions.filter(session => session.current)).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(first.token);
    for (const session of listed.sessions)
        expect(Object.keys(session).sort()).toEqual(["current", "expiresAt", "id", "issuedAt"]);
    const other = listed.sessions.find(session => !session.current)!;
    await expect(client(first.token).revokeSession(other.id)).resolves.toEqual({ revoked: true });
    await expect(client(second.token).status()).rejects.toThrow();
    await host.close();
    host = await startControlHost({ workspace: directory, port: 0 });
    await expect(client(second.token).status()).rejects.toThrow();
    await expect(client(first.token).status()).resolves.toHaveProperty("manager");
    const third = await client().pair((await local.authorizeDevice()).code);
    const recovered = await client().pair((await local.recoverAuthentication()).code);
    await expect(client(first.token).status()).rejects.toThrow();
    await expect(client(third.token).status()).rejects.toThrow();
    const remaining = await client(recovered.token).sessions();
    expect(remaining.sessions).toHaveLength(1);
    await client(recovered.token).revokeSession(remaining.sessions[0].id);
    await expect(client(recovered.token).status()).rejects.toThrow();
});
