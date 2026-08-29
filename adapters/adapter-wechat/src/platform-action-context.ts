import type { PlatformActionHandler } from "onebots";
import type { WechatClient } from "./client.js";

export type WechatActionParams = Readonly<Record<string, unknown>>;
export type WechatActionHandler = PlatformActionHandler<WechatClient>;
