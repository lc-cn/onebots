export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"
export type Dispose = () => any
export type MayBeArray<T extends any> = T | T[]
