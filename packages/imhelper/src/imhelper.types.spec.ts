import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { Adapter } from "./adapter.js";
import { createImHelper } from "./index.js";

interface RawEvent {
    kind: "message";
    text: string;
}

class TypedAdapter extends Adapter<string, RawEvent> {
    readonly selfId = "bot";
    readonly call = vi.fn(async (action: string) => ({ action }));

    transformEvent(event: RawEvent): void {
        this.emit("event", event);
    }
}

describe("ImHelper generic client", () => {
    test("preserves the concrete adapter and raw event types", () => {
        const client = createImHelper(new TypedAdapter());
        expectTypeOf(client.adapter).toMatchTypeOf<TypedAdapter>();
        expectTypeOf(client.adapter.call).toEqualTypeOf<TypedAdapter["call"]>();
        expectTypeOf(client.ingest).parameter(0).toEqualTypeOf<RawEvent>();

        const onEvent = vi.fn();
        client.on("event", event => {
            expectTypeOf(event).toEqualTypeOf<RawEvent>();
            onEvent(event.text);
        });
        client.ingest({ kind: "message", text: "你好" });

        expect(onEvent).toHaveBeenCalledWith("你好");
    });
});
