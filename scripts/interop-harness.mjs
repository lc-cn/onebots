import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";

const MAX_LOG_BYTES = 64 * 1024;

export function startProcess(command, args, environment, label, workingDirectory) {
    const child = spawn(command, args, {
        cwd: workingDirectory,
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = chunk => {
        output = `${output}${chunk.toString()}`.slice(-MAX_LOG_BYTES);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const exit = new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
    child.once("error", error => append(`${label} spawn error: ${error.message}\n`));
    return { child, exit, label, logs: () => output };
}

export async function waitForPort(port, processHandle, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        assertRunning(processHandle);
        if (await canConnect(port)) return;
        await delay(50);
    }
    throw new Error(`${processHandle.label} 未监听端口 ${port}\n${processHandle.logs()}`);
}

export async function waitForEvidence(evidenceFile, processHandles, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        processHandles.forEach(assertRunning);
        if (fs.existsSync(evidenceFile)) return JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
        await delay(50);
    }
    throw new Error(
        `未收到互操作证据\n${processHandles.map(item => `${item.label}:\n${item.logs()}`).join("\n")}`,
    );
}

export async function stopProcess(processHandle) {
    if (processHandle.child.exitCode !== null) return;
    processHandle.child.kill("SIGTERM");
    const stopped = await Promise.race([processHandle.exit.then(() => true), delay(3_000)]);
    if (stopped !== true && processHandle.child.exitCode === null) {
        processHandle.child.kill("SIGKILL");
        await processHandle.exit;
    }
}

export function allocatePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("无法分配端口"));
            server.close(error => (error ? reject(error) : resolve(address.port)));
        });
    });
}

function canConnect(port) {
    return new Promise(resolve => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(250);
        const finish = value => {
            socket.destroy();
            resolve(value);
        };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
        socket.once("timeout", () => finish(false));
    });
}

function assertRunning(processHandle) {
    if (processHandle.child.exitCode !== null) {
        throw new Error(`${processHandle.label} 提前退出\n${processHandle.logs()}`);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
