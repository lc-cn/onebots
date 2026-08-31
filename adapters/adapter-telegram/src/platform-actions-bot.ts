import type { PlatformActionHandler } from "onebots";
import type { TelegramBot } from "./bot.js";
import { requireObjectArray, requireString, telegramAction } from "./platform-action-params.js";

type Handler = PlatformActionHandler<TelegramBot>;

/** Bot 命令、展示资料、菜单按钮与默认管理员权限。 */
export const TELEGRAM_BOT_ACTIONS = {
    set_bot_commands: telegramAction("setMyCommands", (api, params) =>
        api.setMyCommands(
            requireObjectArray(params, "commands", 1, 100) as never,
            params.options as never,
        ),
    ),
    delete_bot_commands: telegramAction("deleteMyCommands", (api, params) =>
        api.deleteMyCommands(params.options as never),
    ),
    get_bot_commands: telegramAction("getMyCommands", (api, params) =>
        api.getMyCommands(params.options as never),
    ),
    set_bot_name: telegramAction("setMyName", (api, params) =>
        api.setMyName(requireString(params, "name", true), params.options as never),
    ),
    get_bot_name: telegramAction("getMyName", (api, params) =>
        api.getMyName(params.options as never),
    ),
    set_bot_description: telegramAction("setMyDescription", (api, params) =>
        api.setMyDescription(requireString(params, "description", true), params.options as never),
    ),
    get_bot_description: telegramAction("getMyDescription", (api, params) =>
        api.getMyDescription(params.options as never),
    ),
    set_bot_short_description: telegramAction("setMyShortDescription", (api, params) =>
        api.setMyShortDescription(
            requireString(params, "short_description", true),
            params.options as never,
        ),
    ),
    get_bot_short_description: telegramAction("getMyShortDescription", (api, params) =>
        api.getMyShortDescription(params.options as never),
    ),
    set_chat_menu_button: telegramAction("setChatMenuButton", (api, params) =>
        api.setChatMenuButton(params.options as never),
    ),
    get_chat_menu_button: telegramAction("getChatMenuButton", (api, params) =>
        api.getChatMenuButton(params.options as never),
    ),
    set_default_administrator_rights: telegramAction(
        "setMyDefaultAdministratorRights",
        (api, params) => api.setMyDefaultAdministratorRights(params.options as never),
    ),
    get_default_administrator_rights: telegramAction(
        "getMyDefaultAdministratorRights",
        (api, params) => api.getMyDefaultAdministratorRights(params.options as never),
    ),
} satisfies Readonly<Record<string, Handler>>;
