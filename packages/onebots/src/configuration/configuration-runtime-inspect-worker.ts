import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { ConfigurationRuntimeInspectInput } from "./configuration-runtime-inspect.js";

if (!process.send || !process.connected) process.exit(1);
function stop(): void {
    try {
        process.kill(-process.pid, "SIGKILL");
    } finally {
        process.exit(1);
    }
}
process.once("disconnect", stop);
process.once("SIGTERM", stop);
process.once("message", async (input: ConfigurationRuntimeInspectInput) => {
    try {
        const require = createRequire(path.join(input.runtimeRoot, "package.json"));
        const hostEntry = input.hostEntrypoint ?? require.resolve("onebots");
        const loader = await import(
            pathToFileURL(path.join(path.dirname(hostEntry), "plugin-loader.js")).href
        );
        const coreEntry = loader.inspectPlugin(["@onebots/core"], createRequire(hostEntry));
        if (coreEntry.status !== "ready") throw new Error();
        await import(pathToFileURL(hostEntry).href);
        const core = await import(pathToFileURL(coreEntry.entryPath).href);
        for (const [type, names] of [
            ["adapter", input.selection.adapters],
            ["protocol", input.selection.protocols],
            ["application", input.selection.applications],
        ] as const) {
            for (const name of names) {
                const result = await loader.tryLoadRegisteredPlugin(
                    type,
                    name,
                    loader.pluginCandidates(type, name),
                    require,
                );
                if (!result.loaded) throw new Error();
            }
        }
        const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
        const { collectRuntimeSchemas } = await import(
            new URL(`./configuration-schema-collection.${extension}`, import.meta.url).href
        );
        const schemas = collectRuntimeSchemas(core, input.selection);
        const hash = createHash("sha256").update(schemas).update(JSON.stringify(input.selection));
        for (const [name, entry] of [
            ["onebots", hostEntry],
            ["@onebots/core", coreEntry.entryPath],
        ]) {
            let directory = path.dirname(fs.realpathSync(entry));
            let found = false;
            for (let depth = 0; depth < 10; depth++) {
                const file = path.join(directory, "package.json");
                if (fs.existsSync(file)) {
                    const bytes = fs.readFileSync(file);
                    if (JSON.parse(bytes.toString("utf8")).name === name) {
                        hash.update(name).update(bytes).update(fs.readFileSync(entry));
                        found = true;
                        break;
                    }
                }
                directory = path.dirname(directory);
            }
            if (!found) throw new Error();
        }
        process.send?.({ schemas, fingerprint: hash.digest("hex") }, () => process.exit(0));
    } catch {
        process.exit(1);
    }
});
if (!process.connected) stop();
