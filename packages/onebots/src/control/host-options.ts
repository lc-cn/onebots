import type { ControlInstallationOptions } from "./installation-service.js";

export interface ControlHostOptions {
    workspace: string;
    host?: string;
    port?: number;
    runtimeRoot?: string;
    webRoot?: string;
    gatewayEntrypoint?: string;
    installation?: Omit<ControlInstallationOptions, "directory" | "store" | "lifecycle">;
}
