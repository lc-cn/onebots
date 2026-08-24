import { Adapter } from "./adapter.js";
export abstract class Receiver<Id extends string | number = string | number, TRawEvent = unknown> {
    constructor(public adapter: Adapter<Id, TRawEvent>) {}
    abstract connect(port?: number): Promise<void>;
    abstract disconnect(): Promise<void>;
}
