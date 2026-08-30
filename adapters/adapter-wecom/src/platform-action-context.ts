import type { PlatformActionHandler } from "onebots";
import type { WeComClient } from "./client.js";

export type WeComActionParams = Readonly<Record<string, unknown>>;
export type WeComActionHandler = PlatformActionHandler<WeComClient>;
