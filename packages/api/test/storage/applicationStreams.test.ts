import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { TimerState } from '@tokkl/types';
import { TimerStreams } from '../../src/services/timerStreams.ts';
const state=(revision:number):TimerState=>({revision,server_time:'2026-10-30T12:00:00.000Z',running_entry:null,pause:null,pomodoro:null,discarded_pomodoro:null});
function gate() { let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve}; }
test('initial builds serialize and an overtaken snapshot never follows a committed state', {timeout:10000}, async t=>{
 const entered=gate(), release=gate();let active=0,max=0,builds=0;
 const streams=new TimerStreams(async()=>{active++;max=Math.max(max,active);if(++builds===1){entered.resolve();await release.promise;}active--;return state(1);});
 const app=express();app.get('/',async(_req,res)=>streams.open(1,res,async()=>true));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
 t.after(async()=>{release.resolve();await streams.closeAll();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const a=fetch(url);await entered.promise;const b=fetch(url);await new Promise(r=>setTimeout(r,40));
 await streams.publish(1,state(3));release.resolve();
 for(const request of [a,b]){const response=await request;const reader=response.body!.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/"revision":3/);await reader.cancel();}
 assert.equal(max,1);
});
test('an initial async failure reaches Express before headers are sent', {timeout:10000},async t=>{
 const streams=new TimerStreams(async()=>{throw Error('read failed');});const app=express();app.get('/',async(_req,res)=>streams.open(1,res,async()=>true));
 app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json('safe error'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await streams.closeAll();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);assert.equal(response.status,500);assert.equal(await response.json(),'safe error');
});
test('a broken initial subscriber leaves no keep-alive and cannot suppress another subscriber', {timeout:10000},async t=>{
 let intervals=0;const original=setInterval;
 t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{intervals++;return original(...args);});
 const streams=new TimerStreams(async()=>state(0));const app=express();
 app.get('/broken',async(_req,res)=>{res.write=()=>{throw Error('broken subscriber');};await streams.open(1,res,async()=>true);});
 app.get('/good',async(_req,res)=>streams.open(1,res,async()=>true));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 t.after(async()=>{await streams.closeAll();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 await (await fetch(base+'/broken')).text();assert.equal(intervals,0);
 const good=await fetch(base+'/good');const reader=good.body!.getReader();await reader.read();
 await streams.publish(1,state(2));const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/"revision":2/);await reader.cancel();
});
