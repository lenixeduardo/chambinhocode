import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../dist/workspace.js';
import { SubagentCoordinator } from '../dist/subagents.js';

class ScriptedModel {
  calls=[]; index=0;
  constructor(responses){this.responses=responses;}
  async chat(route,messages){this.calls.push({route,messages});return {content:JSON.stringify(this.responses[this.index++] || {type:'final',message:'ok'}),provider:'test',model:'test'};}
}
test('planner cannot create files, even if model requests it',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-sub-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const model=new ScriptedModel([{type:'tool',tool:'create_file',args:{path:'unsafe.txt',content:'bad'}},{type:'final',message:'Plano pronto'}]);
 const coordinator=new SubagentCoordinator(model,await Workspace.from(root),'code',async()=>{throw Error('must not approve')});
 assert.equal(await coordinator.runRole('planner','Planejar'),'Plano pronto');
 await assert.rejects(fs.access(path.join(root,'unsafe.txt')));
 assert.match(model.calls[1].messages.at(-1).content,/bloqueada/);
});
test('goal creates separate contexts for planner, implementer and auditor',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-sub-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const model=new ScriptedModel([{type:'final',message:'Plano P'},{type:'final',message:'Implementação I'},{type:'final',message:'Auditoria A'}]);
 const coordinator=new SubagentCoordinator(model,await Workspace.from(root),'code',async()=>false);
 const report=await coordinator.runGoal('Objetivo');
 assert.deepEqual(report,{plan:'Plano P',implementation:'Implementação I',audit:'Auditoria A'});
 assert.equal(model.calls.length,3);
 assert.equal(model.calls[0].messages.length,2);
 assert.equal(model.calls[1].messages.length,2);
 assert.equal(model.calls[2].messages.length,2);
 assert.match(model.calls[1].messages[1].content,/Plano P/);
 assert.match(model.calls[2].messages[1].content,/Implementação I/);
 assert.doesNotMatch(model.calls[2].messages[0].content,/Plano P/);
});
