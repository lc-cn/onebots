import { describe, expect, it } from "vitest";
import { calculateHeychatReconnectDelay } from "./client.js";

describe("calculateHeychatReconnectDelay", () => {
    it("执行封顶的指数退避并支持稳定抖动", () => {
        const middle = (): number => 0.5;
        expect(calculateHeychatReconnectDelay(1, 1_000, 30_000, middle)).toBe(1_000);
        expect(calculateHeychatReconnectDelay(4, 1_000, 30_000, middle)).toBe(8_000);
        expect(calculateHeychatReconnectDelay(20, 1_000, 30_000, middle)).toBe(30_000);
    });
});
