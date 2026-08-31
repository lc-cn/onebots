import type { AdapterCapabilityManifest } from "@onebots/core";
import type { ExtensionInfo } from "../types.js";
import {
    CAPABILITY_CATEGORIES,
    capabilityAvailabilityLabel,
    capabilityDirectionLabel,
    capabilitySceneLabel,
    capabilitySupportLabel,
    getCapabilityEntries,
    type CapabilityCategory,
    type CapabilityEntry,
} from "./capability-presentation.js";

export interface CapabilitySearchMatch extends CapabilityEntry {
    category: CapabilityCategory;
}

export function getCapabilitySearchMatches(
    manifest: AdapterCapabilityManifest,
    query: string,
): CapabilitySearchMatch[] {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return [];
    return CAPABILITY_CATEGORIES.flatMap(({ key, label }) =>
        getCapabilityEntries(manifest, key).flatMap(entry => {
            if (entry.descriptor.support === "unsupported") return [];
            return matchesTokens(tokens, [
                key,
                label,
                entry.name,
                entry.descriptor.support,
                capabilitySupportLabel(entry.descriptor.support),
                entry.descriptor.availability,
                ...(entry.descriptor.availability
                    ? [capabilityAvailabilityLabel(entry.descriptor.availability)]
                    : []),
                entry.descriptor.note,
                ...(entry.descriptor.scenes ?? []),
                ...(entry.descriptor.scenes?.map(capabilitySceneLabel) ?? []),
                ...(entry.descriptor.permissions ?? []),
                ...("direction" in entry.descriptor ? [entry.descriptor.direction] : []),
                ...("direction" in entry.descriptor
                    ? [capabilityDirectionLabel(entry.descriptor.direction)]
                    : []),
                ...("mode" in entry.descriptor ? [entry.descriptor.mode] : []),
            ])
                ? [{ category: key, ...entry }]
                : [];
        }),
    );
}

export function matchesExtensionSearch(extension: ExtensionInfo, query: string): boolean {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return true;
    if (
        matchesTokens(tokens, [
            extension.displayName,
            extension.name,
            extension.description,
            extension.packageName,
        ])
    ) {
        return true;
    }
    const manifest = extension.capability?.manifest;
    return manifest ? getCapabilitySearchMatches(manifest, query).length > 0 : false;
}

function searchTokens(query: string): string[] {
    return query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

function matchesTokens(tokens: readonly string[], values: readonly unknown[]): boolean {
    const haystack = values
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
    return tokens.every(token => haystack.includes(token));
}
