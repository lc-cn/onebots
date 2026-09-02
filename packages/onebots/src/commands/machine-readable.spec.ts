import { describe, expect, it } from "vitest";
import CapabilitiesCommand from "./capabilities.js";
import DoctorCommand from "./doctor.js";
import StatusCommand from "./status.js";

describe("machine-readable command wiring", () => {
    it("为全部 JSON 证据命令启用独占 stdout 边界", () => {
        const capabilities = CapabilitiesCommand({
            options: { register: [], json: true },
        });
        const doctor = DoctorCommand({
            options: {
                register: [],
                protocol: [],
                system: false,
                fix: false,
                json: true,
                strict: false,
            },
        });
        const status = StatusCommand({ options: { system: false, json: true } });

        expect(capabilities.props.machineReadable).toBe(true);
        expect(doctor.props.machineReadable).toBe(true);
        expect(status.props.machineReadable).toBe(true);
    });
});
