import KoaRouter from '@koa/router'
import {WebSocketServer,RawData} from "ws";
import http from "http";
import {parse} from "url";
import { Dict } from "@zhinjs/shared";

export class WsServer extends WebSocketServer{
    waiting_timeout:number=1000*60*5
    async waitResult<T>(event:string,...args:any[]){
        return new Promise<T>(resolve => {
            const resolver=(result:T)=>{
                this.clients.forEach((client)=>client.off('message',listener))
                clearTimeout(timer)
                resolve(result)
            }
            const echo=Date.now().toString(36).slice(2)
            let timer=setTimeout(()=>{
                resolver(null)
            },this.waiting_timeout)
            const listener=(raw:RawData)=>{
                let data:Dict = null
                try{
                    data=JSON.parse(raw.toString())
                }catch {}
                if(!data) return
                if(data.echo===echo) resolver(data.result)
            }
            this.clients.forEach(client=>{
                client.on('message',listener)
                client.send(JSON.stringify({
                    event,
                    echo,
                    args
                }))
            })
        })

    }
}
export class Router extends KoaRouter {
    wsStack: WsServer[] = []

    ws(path: string, server: http.Server) {
        const wsServer = new WsServer({noServer: true, path})
        this.wsStack.push(wsServer)
        server.on('upgrade', (request, socket, head) => {
            const {pathname} = parse(request.url);
            if (this.wsStack.findIndex(wss => wss.options.path === path) === -1) {
                socket.destroy()
            } else if (pathname === path) {
                wsServer.handleUpgrade(request, socket, head, function done(ws) {
                    wsServer.emit('connection', ws, request);
                });
            }
        })
        return wsServer
    }
}
