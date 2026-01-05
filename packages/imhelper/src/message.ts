import type { MaybeArray } from './types.js';
export namespace Message {
    export type Segment = {
        type: string,
        data: Record<string, any>
    }
    export type Content = MaybeArray<Segment>
    export type Ret = any
    export type SceneType = 'private' | 'group' | 'channel';
}