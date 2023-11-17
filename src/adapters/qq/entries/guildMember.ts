import { User } from "./user";
export namespace GuildMember {
    export interface Info {
        user: User.Info
        nick: string
        roles: string[]
        join_time: number
    }
}
