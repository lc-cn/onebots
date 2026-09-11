import "./framework-integration-registration.js";

export { createProfileApplication } from "./framework-integration-application.js";
export {
    createFrameworkConnectionPlan,
    getFrameworkProfile,
    listFrameworkProfiles,
} from "./framework-integration-connection.js";
export {
    defineFrameworkIntegration,
    FrameworkIntegrationRegistry,
} from "./framework-integration-types.js";
export type {
    DistributionCompatibilityAudit,
    FrameworkConfigRenderContext,
    FrameworkConnectionCheck,
    FrameworkConnectionPlan,
    FrameworkConnectionRequest,
    FrameworkId,
    FrameworkIntegrationContext,
    FrameworkIntegrationProvider,
    FrameworkKind,
    FrameworkProfile,
    FrameworkProtocol,
    FrameworkTransport,
    FrameworkVerificationEvidence,
    FrameworkVerificationLevel,
} from "./framework-integration-types.js";
