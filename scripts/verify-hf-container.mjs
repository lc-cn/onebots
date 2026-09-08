// Host-side acceptance only; never prints tokens, deployment codes, or raw Docker output.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const image = process.argv[2] || process.env.ONEBOTS_HF_TEST_IMAGE;
if (!image || image.startsWith("-") || /[\s\0]/.test(image))
    throw new Error("HF test image required");
const prefix = `onebots-hf-check-${randomUUID()}`;
const containers = [],
    volumes = [];
const code = randomBytes(32).toString("base64url");
const downloadToken = randomBytes(32).toString("base64url");
const environment = { ...process.env, ONEBOTS_BOOTSTRAP_CODE: code, HF_TOKEN: downloadToken };
let stage = "initialization";
function docker(args, input) {
    try {
        return execFileSync("docker", args, {
            input,
            env: environment,
            encoding: "utf8",
            timeout: 60_000,
            maxBuffer: 2 * 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
        });
    } catch {
        throw new Error(`HF acceptance failed during ${stage}`);
    }
}
async function waitFor(check, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            const value = await check();
            if (value) return value;
        } catch {
            /* bounded startup observation */
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`HF acceptance timed out during ${stage}`);
}
function volume(suffix) {
    const name = `${prefix}-${suffix}`;
    volumes.push(name);
    docker(["volume", "create", name]);
    return name;
}
function start(name, storage) {
    containers.push(name);
    docker([
        "run",
        "-d",
        "--name",
        name,
        "--env",
        "ONEBOTS_BOOTSTRAP_CODE",
        "--env",
        "HF_TOKEN",
        "--publish",
        "127.0.0.1::7860",
        "--volume",
        `${storage}:/data`,
        image,
    ]);
}
function exec(name, source, input) {
    return docker(
        ["exec", "--user", "1000:1000", "-i", name, "node", "--input-type=module", "-e", source],
        input,
    );
}
const invoke = `
import fs from 'node:fs';
import { ControlClient, createHttpControlTransport } from '/app/packages/core/lib/control.js';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const client = new ControlClient(createHttpControlTransport('http://127.0.0.1:7860', () => request.token || ''));
let value;
if (request.action === 'pair') value = await client.pair(request.code);
else if (request.action === 'stop') value = await client.gateway('stop');
else if (request.action === 'replay') { try { await client.pair(request.code); value = {rejected:false}; } catch { value = {rejected:true}; } }
else value = await client.status();
process.stdout.write(JSON.stringify(value));`;
function client(name, request) {
    return JSON.parse(exec(name, invoke, JSON.stringify(request)));
}
async function base(name) {
    const binding = docker(["port", name, "7860/tcp"]).trim();
    assert.match(binding, /^127\.0\.0\.1:[0-9]+$/);
    const url = `http://${binding}`;
    await waitFor(
        async () =>
            (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) })).status === 200,
    );
    return url;
}
async function httpStatus(url, route, expected) {
    const response = await fetch(`${url}${route}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, expected);
    await response.body?.cancel();
}
function seed(storage, source) {
    // Explicit entrypoint bypass is restricted to this script's new private test volume.
    const name = `${prefix}-seed-${containers.length}`;
    containers.push(name);
    docker([
        "run",
        "--name",
        name,
        "--entrypoint",
        "node",
        "--volume",
        `${storage}:/data`,
        image,
        "--input-type=module",
        "-e",
        source,
    ]);
}
function noCredentialLogs(name, token) {
    const result = spawnSync("docker", ["logs", name], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.status, 0);
    const logs = (result.stdout || "") + (result.stderr || "");
    assert.ok(
        ![code, downloadToken, token].filter(Boolean).some(secret => logs.includes(secret)),
        "credential appeared in container logs",
    );
}
try {
    stage = "empty volume";
    const storage = volume("empty"),
        name = `${prefix}-empty`;
    stage = "empty container launch";
    start(name, storage);
    stage = "empty manager HTTP readiness";
    let url = await base(name);
    await httpStatus(url, "/ready", 200);
    stage = "deployment code pairing";
    const { token } = client(name, { action: "pair", code });
    assert.equal(typeof token, "string");
    stage = "empty gateway ready";
    const first = await waitFor(() => {
        const state = client(name, { token });
        return state.gateway.actual === "running" ? state : null;
    });
    stage = "gateway credential isolation";
    const isolation = exec(
        name,
        `
import fs from 'node:fs';
let phase = 'state';
try {
const state = JSON.parse(fs.readFileSync('/data/.control/gateway.json','utf8'));
if (!state.instance?.pid || state.actual !== 'running') throw new Error('not-ready');
phase = 'environment';
const keys = fs.readFileSync('/proc/'+state.instance.pid+'/environ','utf8').split('\\0').map(item=>item.split('=')[0]);
process.stdout.write(JSON.stringify({safe: keys.includes('PATH') && !keys.includes('ONEBOTS_BOOTSTRAP_CODE') && !keys.includes('HF_TOKEN')}));
} catch(error) { process.stdout.write(JSON.stringify({phase, errno:['EACCES','EPERM','ENOENT'].includes(error.code)?error.code:'UNKNOWN'})); }`,
    );
    const isolated = JSON.parse(isolation);
    if (isolated.errno) {
        stage = `gateway isolation ${isolated.phase === "environment" ? "environment" : "state"} ${["EACCES", "EPERM", "ENOENT"].includes(isolated.errno) ? isolated.errno : "UNKNOWN"}`;
    }
    assert.equal(isolated.safe, true);
    stage = "legacy login rejection";
    const oldLogin = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin" }),
        signal: AbortSignal.timeout(3000),
    });
    assert.ok([401, 404].includes(oldLogin.status));
    assert.equal(oldLogin.headers.get("set-cookie"), null);
    await oldLogin.body?.cancel();
    stage = "gateway stop with Web retained";
    assert.equal(client(name, { action: "stop", token }).status, "succeeded");
    await httpStatus(url, "/", 200);
    await httpStatus(url, "/ready", 200);
    stage = "empty credential logs";
    noCredentialLogs(name, token);
    stage = "restart without deployment-code replay";
    docker(["restart", "--time", "20", name]);
    url = await base(name);
    const restarted = client(name, { token });
    assert.notEqual(restarted.manager.id, first.manager.id);
    assert.equal(restarted.gateway.actual, "stopped");
    assert.equal(restarted.gateway.desired, "stopped");
    assert.equal(client(name, { action: "replay", code }).rejected, true);
    await httpStatus(url, "/", 200);
    noCredentialLogs(name, token);
    stage = "damaged existing configuration";
    const brokenVolume = volume("damaged"),
        broken = `${prefix}-damaged`;
    const original = "synthetic-private-value: [\r\n";
    seed(
        brokenVolume,
        `import fs from 'node:fs'; fs.writeFileSync('/data/config.yaml',${JSON.stringify(original)},{mode:0o600});`,
    );
    start(broken, brokenVolume);
    const brokenUrl = await base(broken);
    await httpStatus(brokenUrl, "/", 200);
    assert.equal(
        exec(
            broken,
            "import fs from 'node:fs'; process.stdout.write(fs.readFileSync('/data/config.yaml'))",
        ),
        original,
    );
    noCredentialLogs(broken);
    stage = "interrupted restore gate";
    const interruptedVolume = volume("interrupted"),
        interrupted = `${prefix}-interrupted`;
    seed(
        interruptedVolume,
        "import fs from 'node:fs'; fs.mkdirSync('/data/.hf-restore-pending',{mode:0o700});",
    );
    start(interrupted, interruptedVolume);
    const state = await waitFor(() => {
        const value = JSON.parse(docker(["inspect", "--format", "{{json .State}}", interrupted]));
        return !value.Running ? value : null;
    });
    assert.notEqual(state.ExitCode, 0);
    noCredentialLogs(interrupted);
    console.log(
        "HF container acceptance passed: pairing, restart, private gateway, damaged configuration and restore gate",
    );
} catch {
    process.exitCode = 1;
    console.error(`HF container acceptance failed: ${stage}`);
} finally {
    stage = "cleanup";
    for (const name of containers.reverse()) {
        try {
            docker(["rm", "-f", name]);
        } catch {
            process.exitCode = 1;
            console.error("HF test container cleanup failed");
        }
    }
    for (const name of volumes.reverse()) {
        try {
            docker(["volume", "rm", name]);
        } catch {
            process.exitCode = 1;
            console.error("HF test volume cleanup failed");
        }
    }
}
