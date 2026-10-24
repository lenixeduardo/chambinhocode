import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent,parseAction} from '../dist/agent.js';
import {GatewayClient} from '../dist/gateway.js';

test('complex plan action parses with bounded steps',()=>{
 assert.deepEqual(parseAction('{"type":"plan","steps":["inspect","test"]}'),{type:'plan',steps:['inspect','test']});
 assert.throws(()=>parseAction('{"type":"plan","steps":[]}'));
});
test('agent retries a transient model failure and emits plan',async()=>{
 let calls=0; const events=[];
 const client={chat:async()=>{calls++; if(calls===1) throw Error('transient'); if(calls===2) return {content:'{"type":"plan","steps":["inspect","test"]}',provider:'mock',model:'mock'}; return {content:'{"type":"final","message":"ok"}',provider:'mock',model:'mock'};}};
 const agent=new Agent(client,{execute:async()=>''},'code',async()=>false,e=>events.push(e));
 assert.equal(await agent.run('repair'),'ok'); assert.equal(calls,3);
 assert.ok(events.some(e=>e.kind==='plan'));
});
test('gateway streaming SSE assembles fragments',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){const e=new TextEncoder(); for(const part of ['event: meta\ndata: {"provider":"mock","model":"m"}\n\n','event: delta\ndata: {"content":"hello "}\n\n','event: delta\ndata: {"content":"world"}\n\n','event: done\ndata: {}\n\n']) c.enqueue(e.encode(part)); c.close();}}),{status:200});
 try {const deltas=[]; const result=await new GatewayClient('http://localhost:8000','x'.repeat(24)).chatStream('code',[{role:'user',content:'hi'}],d=>deltas.push(d)); assert.equal(result.content,'hello world'); assert.deepEqual(deltas,['hello ','world']);}
 finally {globalThis.fetch=original;}
});
