import { ImHelper, type EventMap } from "imhelper";
import { createSatoriAdapter, type SatoriAdapter, type SatoriAdapterConfig } from "./adapter.js";
import type { SatoriV1Event } from "./types.js";

export class SatoriV1Client extends ImHelper<
    string,
    SatoriV1Event,
    EventMap<string>,
    SatoriAdapter
> {
    constructor(config: SatoriAdapterConfig) {
        super(createSatoriAdapter(config));
    }

    call<T = unknown>(
        resource: string,
        method: string,
        params?: Record<string, unknown>,
    ): Promise<T> {
        return this.adapter.call<T>(resource, method, params);
    }
}

export function createSatoriClient(config: SatoriAdapterConfig): SatoriV1Client {
    return new SatoriV1Client(config);
}
