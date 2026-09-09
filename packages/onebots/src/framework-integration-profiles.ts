import { listFrameworkEcosystem } from "./framework-ecosystem.js";
import { DISTRIBUTION_FRAMEWORK_PROFILES } from "./framework-integration-distribution-profiles.js";
import { FRAMEWORK_PROFILES } from "./framework-integration-framework-profiles.js";
import type { FrameworkProfile } from "./framework-integration-types.js";
import { deepFreeze } from "./framework-integration-utils.js";

export const BUILTIN_PROFILES: Readonly<Record<string, FrameworkProfile>> = deepFreeze({
    ...FRAMEWORK_PROFILES,
    ...DISTRIBUTION_FRAMEWORK_PROFILES,
});

export const ECOSYSTEM_PROFILES = listFrameworkEcosystem().map(entry =>
    deepFreeze<FrameworkProfile>({
        id: entry.id,
        displayName: entry.displayName,
        kind: entry.kind,
        packageName: null,
        protocol: entry.runtime.protocol,
        transport: entry.runtime.transport,
        verification: "documented",
        upstream: entry.upstream,
        defaultFrameworkOrigin: entry.runtime.defaultFrameworkOrigin,
        limitations: [entry.limitation],
        applicationStage: entry.runtime.stage,
    }),
);
