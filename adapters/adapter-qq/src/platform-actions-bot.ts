import type { QQClient } from "./client.js";
import type { QQActionHandler, QQActionParams } from "./platform-action-context.js";
import { optionalQuery, requiredRecord, requiredString } from "./platform-action-params.js";

/** 机器人菜单与面板动作。 */
export const QQ_BOT_ACTIONS = {
    generate_share_link: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: "/v2/generate_url_link",
            body: requiredRecord(params, "link"),
        }),
    get_bot_menu: async (client: QQClient) => client.call({ method: "GET", path: "/v2/menu" }),
    update_bot_menu: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "PUT",
            path: "/v2/menu",
            body: { menu: requiredRecord(params, "menu") },
        }),
    list_bot_panels: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "GET",
            path: "/v2/panels",
            query: optionalQuery(params.query),
        }),
    create_bot_panel: async (client: QQClient, params: QQActionParams) =>
        client.call({
            method: "POST",
            path: "/v2/panels",
            body: requiredRecord(params, "panel"),
        }),
    get_bot_panel: panelAction("GET"),
    update_bot_panel: panelAction("PUT"),
    delete_bot_panel: panelAction("DELETE"),
    publish_bot_panel: panelAction("PUBLISH"),
} satisfies Readonly<Record<string, QQActionHandler>>;

function panelAction(method: "GET" | "PUT" | "DELETE" | "PUBLISH"): QQActionHandler {
    return async (client, params) => {
        const path = `/v2/panels/${requiredString(params, "panel_id")}`;
        switch (method) {
            case "GET":
            case "DELETE":
                return client.call({ method, path });
            case "PUT":
                return client.call({
                    method,
                    path,
                    body: { panel: requiredRecord(params, "panel") },
                });
            case "PUBLISH":
                return client.call({
                    method: "PUT",
                    path: `${path}/target`,
                    body: requiredRecord(params, "target"),
                });
        }
    };
}
