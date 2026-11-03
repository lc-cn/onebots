// Host-side acceptance only; never prints tokens, deployment codes, or raw Docker output.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { registerContainerWorkspace } from "./prepare-container-workspace.mjs";

const image = process.argv[2] || process.env.ONEBOTS_HF_TEST_IMAGE;
if (!image || image.startsWith("-") || /[\s\0]/.test(image))
    throw new Error("HF test image required");
const prefix = `onebots-hf-check-${randomUUID()}`;
const containers = [],
    volumes = [];
const authorities = new Map();
const code = randomBytes(32).toString("base64url");
const recoveryCode = randomBytes(32).toString("base64url");
const downloadToken = randomBytes(32).toString("base64url");
const environment = {
    ...process.env,
    ONEBOTS_BOOTSTRAP_CODE: code,
    ONEBOTS_RECOVERY_CODE: recoveryCode,
    HF_TOKEN: downloadToken,
};
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
function start(name, storage, recovery = false) {
    containers.push(name);
    docker([
        "run",
        "-d",
        "--name",
        name,
        "--env",
        recovery ? "ONEBOTS_RECOVERY_CODE" : "ONEBOTS_BOOTSTRAP_CODE",
        "--env",
        "HF_TOKEN",
        "--publish",
        "127.0.0.1::7860",
        "--volume",
        `${storage}:/data`,
        "--volume",
        `${authorities.get(storage)}:/var/lib/onebots-authority`,
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
    // These fault fixtures are already registered and belong to the real node manager user.
    // Root-created 0600 files would test an ownership failure and previously relied on chown-R.
    const name = `${prefix}-seed-${containers.length}`;
    containers.push(name);
    docker([
        "run",
        "--name",
        name,
        "--entrypoint",
        "node",
        "--user",
        "1000:1000",
        "--mount",
        `type=volume,source=${storage},target=/data,volume-nocopy`,
        image,
        "--input-type=module",
        "-e",
        source,
    ]);
}
function register(storage) {
    const authority = volume(`authority-${authorities.size}`);
    authorities.set(storage, authority);
    registerContainerWorkspace(
        image,
        `type=volume,source=${storage},target=/data`,
        `type=volume,source=${authority},target=/var/lib/onebots-authority`,
        docker,
    );
}
function noCredentialLogs(name, ...tokens) {
    const result = spawnSync("docker", ["logs", name], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.status, 0);
    const logs = (result.stdout || "") + (result.stderr || "");
    assert.ok(
        ![code, recoveryCode, downloadToken, ...tokens]
            .filter(Boolean)
            .some(secret => logs.includes(secret)),
        "credential appeared in container logs",
    );
}
function restoreMounts(storage, authority) {
    // Docker may copy image directory metadata onto an empty named volume on every mount.
    // The rejection fixture compares application effects, so seed/inspect/run use identical
    // real targets with copy-up disabled; retain root ctime and ownership in the assertion.
    return [
        "--mount",
        `type=volume,source=${storage},target=/data,volume-nocopy`,
        "--mount",
        `type=volume,source=${authority},target=/var/lib/onebots-authority,volume-nocopy`,
    ];
}
function restoreFixture(storage, authority, source) {
    return docker([
        "run",
        "--rm",
        "--entrypoint",
        "node",
        ...restoreMounts(storage, authority),
        image,
        "--input-type=module",
        "-e",
        source,
    ]);
}
function restoreFingerprint(storage, authority) {
    return restoreFixture(
        storage,
        authority,
        `
import fs from 'node:fs'; const result=[];
function visit(file,label) { const stat=fs.lstatSync(file,{bigint:true});
if(stat.isSymbolicLink()) throw new Error('unexpected-link');
result.push({label,uid:String(stat.uid),gid:String(stat.gid),mode:String(stat.mode),
ctimeNs:String(stat.ctimeNs),bytes:stat.isFile()?fs.readFileSync(file).toString('hex'):null});
if(stat.isDirectory()) for(const name of fs.readdirSync(file).sort()) visit(file+'/'+name,label+'/'+name); }
visit('/data','data'); visit('/var/lib/onebots-authority','authority'); process.stdout.write(JSON.stringify(result));`,
    );
}
async function rejectAutomaticRestore(storage, authority) {
    const before = restoreFingerprint(storage, authority);
    const dataRoot = JSON.parse(before).find(item => item.label === "data");
    assert.equal(dataRoot.uid, "0", "采样不能被 Docker image copy-up 改回 node 属主");
    assert.equal(Number(dataRoot.mode) & 0o777, 0o700);
    const name = `${prefix}-disabled-restore-${containers.length}`;
    containers.push(name);
    docker([
        "run",
        "-d",
        "--name",
        name,
        "--env",
        "HF_REPO_ID=disabled-fixture",
        "--env",
        "HF_TOKEN",
        ...restoreMounts(storage, authority),
        image,
    ]);
    const state = await waitFor(() => {
        const value = JSON.parse(docker(["inspect", "--format", "{{json .State}}", name]));
        return !value.Running ? value : null;
    });
    assert.equal(state.ExitCode, 1);
    assert.ok(docker(["logs", name]).includes("首期禁用 HF_REPO_ID 自动恢复"));
    assert.equal(restoreFingerprint(storage, authority), before);
    noCredentialLogs(name);
}
try {
    stage = "HF_REPO_ID refuses before empty-root handoff or authority initialization";
    const restoreEmpty = volume("restore-empty"),
        restoreEmptyAuthority = volume("restore-empty-authority");
    restoreFixture(
        restoreEmpty,
        restoreEmptyAuthority,
        "import fs from 'node:fs'; fs.chownSync('/data',0,0); fs.chmodSync('/data',0o700);",
    );
    await rejectAutomaticRestore(restoreEmpty, restoreEmptyAuthority);
    stage = "HF_REPO_ID preserves existing authentication, account and authority metadata";
    const restoreExisting = volume("restore-existing"),
        restoreExistingAuthority = volume("restore-existing-authority");
    restoreFixture(
        restoreExisting,
        restoreExistingAuthority,
        `import fs from 'node:fs'; fs.chownSync('/data',0,0); fs.chmodSync('/data',0o700);
fs.mkdirSync('/data/.control',{mode:0o700}); fs.writeFileSync('/data/.control/auth.json','synthetic-auth',{mode:0o600});
fs.mkdirSync('/data/data',{mode:0o700}); fs.writeFileSync('/data/data/account.bin','synthetic-session',{mode:0o600});
fs.mkdirSync('/var/lib/onebots-authority/authority',{mode:0o700});
fs.writeFileSync('/var/lib/onebots-authority/authority/authority.sqlite','synthetic-authority',{mode:0o600});`,
    );
    await rejectAutomaticRestore(restoreExisting, restoreExistingAuthority);
    stage = "empty volume";
    const storage = volume("empty"),
        name = `${prefix}-empty`;
    stage = "empty container launch";
    register(storage);
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
process.stdout.write(JSON.stringify({safe: keys.includes('PATH') && !keys.includes('ONEBOTS_BOOTSTRAP_CODE') && !keys.includes('ONEBOTS_RECOVERY_CODE') && !keys.includes('HF_TOKEN')}));
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
    stage = "deployment recovery on preserved volume";
    docker(["stop", "--time", "20", name]);
    const recoveredName = `${prefix}-recovered`;
    start(recoveredName, storage, true);
    const recoveryUrl = await base(recoveredName);
    assert.equal(client(recoveredName, { token }).gateway.desired, "stopped");
    const next = client(recoveredName, { action: "pair", code: recoveryCode });
    const rejected = await fetch(`${recoveryUrl}/api/control/status`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
    });
    assert.equal(rejected.status, 401);
    await rejected.body?.cancel();
    assert.equal(client(recoveredName, { token: next.token }).gateway.desired, "stopped");
    docker(["restart", "--time", "20", recoveredName]);
    await base(recoveredName);
    assert.equal(client(recoveredName, { action: "replay", code: recoveryCode }).rejected, true);
    assert.equal(client(recoveredName, { token: next.token }).gateway.desired, "stopped");
    noCredentialLogs(recoveredName, token, next.token);
    stage = "damaged existing configuration";
    const brokenVolume = volume("damaged"),
        broken = `${prefix}-damaged`;
    const original = "synthetic-private-value: [\r\n";
    register(brokenVolume);
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
    register(interruptedVolume);
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
        "HF container acceptance passed: disabled automatic restore preserves empty/existing volumes; pairing, restart, private gateway, damaged configuration and pending-restore gate",
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
