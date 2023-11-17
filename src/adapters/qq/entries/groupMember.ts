import {User} from "./user";

export namespace GroupMember {
    export interface Info {
        user: User.Info
        group_id:string
    }
}
