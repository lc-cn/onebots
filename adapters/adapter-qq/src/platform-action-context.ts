import type { PlatformActionHandler } from "onebots";
import type { QQClient } from "./client.js";

export type QQActionParams = Readonly<Record<string, unknown>>;
export type QQActionHandler = PlatformActionHandler<QQClient>;
