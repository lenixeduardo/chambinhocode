import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../dist/workspace.js';
import {ParallelCoordinator} from '../dist/parallel.js';

class FakeModel {
  constructor(action){this.action=action;this.count=new Map();}
  async chat(_route,messages){
    const prompt=messages[1].content;
    const task=prompt.match(/Tarefa original \(dados do usuário\):\n([^\n]+)/)?.[1]||'';
    const n=this.count.get(task)||0;this.count.set(task,n+1);
    return {content:JSON.stringify(n===0?this.action(task):{type:'final',message:`feito ${task}`}),provider:'fake',model:'fake'};
  }
}
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-par-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,ws:await Workspace.from(root)};}
test('parallel workers merge disjoint file creations after approvals',async t=>{
 const {root,ws}=await setup(t);
 const model=new FakeModel(task=>({type:'tool',tool:'create_file',args:{path:`${task}.txt`,content:task}}));
 const coordinator=new ParallelCoordinator(model,ws,'code',async()=>true);
 const results=await coordinator.run([{role:'implementer',task:'alpha'},{role:'implementer',task:'beta'}]);
 assert.deepEqual(results.map(x=>x.changes),[['alpha.txt'],['beta.txt']]);
 assert.equal(await fs.readFile(path.join(root,'alpha.txt'),'utf8'),'alpha');
 assert.equal(await fs.readFile(path.join(root,'beta.txt'),'utf8'),'beta');
});
test('parallel conflicting writes are not merged',async t=>{
 const {root,ws}=await setup(t);
 const model=new FakeModel(task=>({type:'tool',tool:'create_file',args:{path:'shared.txt',content:task}}));
 const results=await new ParallelCoordinator(model,ws,'code',async()=>true).run([{role:'implementer',task:'one'},{role:'implementer',task:'two'}]);
 assert.equal(results.every(x=>x.conflicts.some(c=>c.includes('múltiplos agentes'))),true);
 await assert.rejects(fs.access(path.join(root,'shared.txt')));
});
test('read-only workers cannot write to their snapshots or live workspace',async t=>{
 const {root,ws}=await setup(t);
 const model=new FakeModel(()=>({type:'tool',tool:'create_file',args:{path:'blocked.txt',content:'x'}}));
 const results=await new ParallelCoordinator(model,ws,'code',async()=>{throw Error('unexpected approval')}).run([{role:'planner',task:'plan'},{role:'auditor',task:'audit'}]);
 assert.deepEqual(results.map(x=>x.changes),[[],[]]);
 await assert.rejects(fs.access(path.join(root,'blocked.txt')));
});
