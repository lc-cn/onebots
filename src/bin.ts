#!/usr/bin/env node
"use strict";
import {createApp} from "@/server/app";
const execArgv=process.argv.splice(2);
const obj={}
for(let i=0;i<execArgv.length;i+=2){
    obj[execArgv[i]]=execArgv[i+1]
}
console.log(obj)
createApp(obj['-c']).start()