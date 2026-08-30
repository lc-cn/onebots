import type { CommonTypes } from "onebots";

export interface TelegramEventProjectorContext {
    botId: CommonTypes.Id;
    createId(value: string | number): CommonTypes.Id;
}
