import type { PlatformActionHandler } from "onebots";
import { exactParams, requireInteger, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";
import { ZulipError } from "./errors.js";

const EXPORT_TYPES = new Set(["public", "full_with_consent", "full_without_consent"]);
export const ZULIP_DATA_EXPORT_MUTATION_ACTIONS: ReadonlySet<string> = new Set([
    "create_data_export",
    "delete_data_export",
]);

/** Zulip 组织 Data Export 资源动作。 */
export const ZULIP_DATA_EXPORT_ACTION_HANDLERS = {
    list_data_exports: (client, params) => {
        exactParams(params, []);
        return client.call("export/realm");
    },
    create_data_export: (client, params) => {
        const body = exactParams(params, ["export_type"]);
        if (body.export_type !== undefined) requireExportType(body.export_type);
        return client.call("export/realm", "POST", body);
    },
    delete_data_export: (client, params) => {
        const exportId = requireInteger(params.export_id, "export_id");
        const body = { ...params };
        delete body.export_id;
        exactParams(body, []);
        return client.call(`export/realm/${exportId}`, "DELETE");
    },
    get_data_export_consents: (client, params) => {
        exactParams(params, []);
        return client.call("export/realm/consents");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;

function requireExportType(value: unknown): string {
    const exportType = requireString(value, "export_type");
    if (!EXPORT_TYPES.has(exportType)) {
        throw new ZulipError("Zulip export_type 不是支持的数据导出类型", {
            code: "ZULIP_INVALID_ACTION_PARAM",
        });
    }
    return exportType;
}
