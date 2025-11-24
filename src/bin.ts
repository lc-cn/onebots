#!/usr/bin/env node
"use strict";
import { createOnebots, App } from "@/server/app.js";
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
const obj = {};
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
createOnebots(obj["-c"]).start();
