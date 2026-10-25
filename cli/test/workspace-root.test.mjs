import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../dist/workspace.js';

test('CLI subfolder selects repository root for file operations', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-project-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'.git'));
  await fs.mkdir(path.join(root,'cli'));
  const ws=await Workspace.from(path.join(root,'cli'));
  assert.equal(ws.root,await fs.realpath(root));
  const result=await ws.execute({type:'tool',tool:'create_file',args:{path:'hello_world.html',content:'<h1>Hello</h1>'}},async()=>true);
  assert.match(result,/Criado e verificado:/);
  assert.match(await fs.readFile(path.join(root,'hello_world.html'),'utf8'),/Hello/);
  assert.match(await ws.listFiles(),/hello_world.html/);
  assert.match(await ws.searchText('hello_world.html'),/Nenhuma ocorrência no conteúdo/);
});

test('normal non-cli folder remains the workspace',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-other-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const ws=await Workspace.from(root);
  assert.equal(ws.root,await fs.realpath(root));
});
