#!/usr/bin/env node
"use strict";
import { createOnebots, App } from "./app.js";
import process from "process";

const execArgv = process.argv.splice(2);
// let cp: ChildProcess | null;
// if (process.env.TS_NODE_DEV) {
//     cp = exec("vite");
//     cp.stdout.on("data", data => {
//         console.log(data);
//     });
//     cp.stderr.on("data", e => {
//         console.error(e);
//     });
// }
const obj: Record<string, string | string[]> = {};
for (let i = 0; i < execArgv.length; i += 2) {
    const key = execArgv[i];
    const value = execArgv[i + 1];
    if (!obj[key]) obj[key] = value;
    else {
        if (Array.isArray(obj[key])) obj[key].push(value);
        else obj[key] = [obj[key], value];
    }
}
if (obj["-r"]) {
    const adapters = [].concat(obj["-r"]);
    for (const adapter of adapters) {
        await App.registerAdapter(adapter);
    }
}
if (!obj['-p']) obj['-p'] = []
if (!Array.isArray(obj['-p'])) obj['-p'] = [obj['-p'] as string]
if (obj["-p"]) {
    const protocols = [].concat(obj["-p"]);
    for (const protocol of protocols) {
        const nameVersion=protocol.split("-");
        const version=nameVersion.pop()!;
        const name=nameVersion.join("-");
        await App.registerProtocol(name,version);
    }
}
if (Array.isArray(obj['-c'])) obj['-c'] = obj['-c'][obj['-c'].length - 1]
createOnebots(obj["-c"] as string).start();
