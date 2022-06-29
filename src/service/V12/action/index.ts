import {CommonAction} from "./common";
import {FriendAction} from "./friend";
import {GroupAction} from "./group";
import {GuidAction} from "./guid";
import {Mixin} from "@/utils";

export interface Action extends CommonAction,FriendAction,GroupAction,GuidAction{}
export class Action extends Mixin(CommonAction,FriendAction,GroupAction,GuidAction){}
