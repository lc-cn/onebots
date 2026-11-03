/** Isolated real-container regression: entrypoints must not repair a rejected copy's data. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { registerContainerWorkspace } from "./prepare-container-workspace.mjs";

const images = process.argv.slice(2);
assert.ok(images.length > 0 && images.every(image => !/^[-\s]/u.test(image)));
const prefix = `onebots-preserve-${randomUUID()}`;
const volumes = [],
    containers = [];
let stage = "initialize";
function docker(args, input) {
    try {
        return execFileSync("docker", args, {
            input,
            encoding: "utf8",
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
        });
    } catch {
        throw new Error(`Container preservation regression failed during ${stage}`);
    }
}
function volume() {
    const name = `${prefix}-${volumes.length}`;
    docker(["volume", "create", name]);
    volumes.push(name);
    return name;
}
function fixture(image, mounts, source) {
    return docker([
        "run",
        "--rm",
        "--entrypoint",
        "node",
        ...mounts.flatMap(mount => ["--volume", mount]),
        image,
        "--input-type=module",
        "-e",
        source,
    ]);
}
const fingerprintSource = `import fs from 'node:fs';
const result = ['.control/auth.json', 'accounts/fixture/session.bin'].map(name => {
    const file = '/data/' + name, stat = fs.statSync(file, {bigint:true});
    return {name, uid:String(stat.uid), gid:String(stat.gid), mode:String(stat.mode),
        ctimeNs:String(stat.ctimeNs), bytes:fs.readFileSync(file).toString('hex')};
});
process.stdout.write(JSON.stringify(result));`;
async function waitFor(check) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const value = await check().catch(() => null);
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Container preservation regression timed out during ${stage}`);
}
try {
    for (const image of images) {
        stage = "fresh root-owned empty volume registration";
        const original = volume(),
            authority = volume(),
            copy = volume();
        const dataMount = `type=volume,source=${original},target=/data`;
        const authorityMount = `type=volume,source=${authority},target=/var/lib/onebots-authority`;
        const fresh = JSON.parse(
            fixture(
                image,
                [`${original}:/data`],
                `
import fs from 'node:fs'; fs.chownSync('/data',0,0); const stat=fs.statSync('/data');
process.stdout.write(JSON.stringify({uid:stat.uid, empty:fs.readdirSync('/data').length===0}));`,
            ),
        );
        assert.equal(fresh.uid, 0);
        assert.equal(fresh.empty, true);
        registerContainerWorkspace(image, dataMount, authorityMount, docker);
        const registered = JSON.parse(
            docker([
                "run",
                "--rm",
                "--mount",
                dataMount,
                "--mount",
                authorityMount,
                image,
                "workspace",
                "inspect",
                "--data-dir",
                "/data",
                "--authority-dir",
                "/var/lib/onebots-authority/authority",
            ]),
        );
        assert.equal(registered.state, "verified");

        stage = "copy registered source and prepare synthetic protected business bytes";
        fixture(
            image,
            [`${original}:/original`, `${copy}:/data`],
            `
import fs from 'node:fs';
for (const name of fs.readdirSync('/original')) fs.cpSync('/original/'+name,'/data/'+name,{recursive:true});
function owner(file) { const stat=fs.lstatSync(file); fs.chownSync(file,1000,1000);
    if(stat.isDirectory()) for(const name of fs.readdirSync(file)) owner(file+'/'+name); }
owner('/data');
fs.writeFileSync('/data/.control/auth.json','synthetic-preserve-auth\\n',{mode:0o600});
fs.chownSync('/data/.control/auth.json',0,0);
fs.mkdirSync('/data/accounts/fixture',{recursive:true,mode:0o700});
fs.writeFileSync('/data/accounts/fixture/session.bin','synthetic-preserve-session\\n',{mode:0o600});
fs.chownSync('/data/accounts/fixture/session.bin',1345,1346);`,
        );
        const before = fixture(image, [`${copy}:/data`], fingerprintSource);
        const name = `${prefix}-${containers.length}`;
        containers.push(name);
        stage = "real entrypoint rejection of copied physical workspace";
        docker([
            "run",
            "-d",
            "--name",
            name,
            "--publish",
            "127.0.0.1::6727",
            "--volume",
            `${copy}:/data`,
            "--volume",
            `${authority}:/var/lib/onebots-authority`,
            image,
            "serve",
            "--data-dir",
            "/data",
            "--authority-dir",
            "/var/lib/onebots-authority/authority",
            "--host",
            "0.0.0.0",
            "--port",
            "6727",
        ]);
        const address = docker(["port", name, "6727/tcp"]).trim();
        assert.match(address, /^127\.0\.0\.1:[0-9]+$/u);
        const admission = await waitFor(async () => {
            const response = await fetch(`http://${address}/api/control/workspace-admission`, {
                signal: AbortSignal.timeout(1000),
            });
            return response.ok ? response.json() : null;
        });
        assert.equal(admission.reason, "DIRECTORY_IDENTITY_MISMATCH");
        assert.equal((await fetch(`http://${address}/api/control/status`)).status, 503);
        stage = "rejected manager preserves bytes and uid/gid/mode/ctime while running";
        assert.equal(fixture(image, [`${copy}:/data`], fingerprintSource), before);
        docker(["stop", "--time", "20", name]);
        stage = "rejected manager close preserves bytes and uid/gid/mode/ctime";
        assert.equal(fixture(image, [`${copy}:/data`], fingerprintSource), before);

        stage = "hidden content is existing data, never an empty mount handoff";
        const hidden = volume();
        fixture(
            image,
            [`${hidden}:/data`],
            `import fs from 'node:fs';
fs.chownSync('/data',0,0); fs.chmodSync('/data',0o700);
fs.writeFileSync('/data/.hidden','preserve-hidden',{mode:0o600});`,
        );
        const hiddenFingerprint = `import fs from 'node:fs';
process.stdout.write(JSON.stringify(['/data','/data/.hidden'].map(file=>{
const stat=fs.statSync(file,{bigint:true}); return {uid:String(stat.uid),gid:String(stat.gid),
mode:String(stat.mode),ctimeNs:String(stat.ctimeNs),bytes:stat.isFile()?fs.readFileSync(file).toString('hex'):null};})));`;
        const hiddenBefore = fixture(image, [`${hidden}:/data`], hiddenFingerprint);
        const refused = spawnSync(
            "docker",
            [
                "run",
                "--rm",
                "--volume",
                `${hidden}:/data`,
                "--volume",
                `${authority}:/var/lib/onebots-authority`,
                image,
                "workspace",
                "inspect",
                "--data-dir",
                "/data",
                "--authority-dir",
                "/var/lib/onebots-authority/authority",
            ],
            { encoding: "utf8", timeout: 30_000 },
        );
        assert.equal(refused.error, undefined);
        assert.equal(refused.status, 1);
        assert.ok((refused.stdout + refused.stderr).includes("既有目录未自动修改"));
        assert.equal(fixture(image, [`${hidden}:/data`], hiddenFingerprint), hiddenBefore);
    }
    process.stdout.write(
        "Container entrypoints: fresh root-volume registration and rejected-copy business/auth metadata preservation passed\n",
    );
} finally {
    for (const name of containers.reverse()) docker(["rm", "-f", name]);
    for (const name of volumes.reverse()) docker(["volume", "rm", name]);
}
