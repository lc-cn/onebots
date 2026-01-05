import { Adapter } from './adapter.js';
export abstract class Receiver<Id extends string | number=string|number> {
    constructor(public adapter: Adapter<Id>) {
    }
    abstract connect(port?: number): Promise<void>;
    abstract disconnect(): Promise<void>;
}