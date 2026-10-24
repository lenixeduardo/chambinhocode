import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../dist/workspace.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'raiz-cli-'));
  t.after(async()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'src'));
  await fs.writeFile(path.join(root,'src','hello.ts'),'export const hello = "world";\n');
  await fs.writeFile(path.join(root,'.env'),'PRIVATE_KEY=never_share');
  return {root, ws:await Workspace.from(root)};
}

test('list_files, read_file, search_text and git restriction', async t => {
  const {ws} = await fixture(t);
  const allow = async () => true;
  assert.match(await ws.execute({type:'tool',tool:'list_files',args:{path:'.'}}, allow),/src\/hello.ts/);
  assert.match(await ws.execute({type:'tool',tool:'read_file',args:{path:'src/hello.ts'}}, allow),/hello = "world"/);
  assert.match(await ws.execute({type:'tool',tool:'search_text',args:{query:'hello'}}, allow),/hello.ts:1/);
  await assert.rejects(()=>ws.execute({type:'tool',tool:'run_command',args:{program:'bash',argv:['-c','echo bad']}},allow),/não autorizado/);
  await assert.rejects(()=>ws.execute({type:'tool',tool:'run_command',args:{program:'git',argv:['push']}},allow),/restrito/);
});

test('refuses traversal and confidential files', async t => {
  const {ws,root}=await fixture(t);
  await assert.rejects(()=>ws.readFile('../other-file'),/fora do projeto/);
  await assert.rejects(()=>ws.readFile('.env'),/bloqueado/);
  await fs.symlink(path.join(root,'src','hello.ts'),path.join(root,'alias.ts'));
  await assert.rejects(()=>ws.readFile('alias.ts'),/Links simbólicos/);
  await fs.symlink(os.tmpdir(),path.join(root,'linked'));
  await assert.rejects(()=>ws.readFile('linked/test.txt'),/Links simbólicos/);
});

test('file edits require approval; only one exact match', async t => {
  const {ws,root} = await fixture(t);
  const action={type:'tool',tool:'replace_text',args:{path:'src/hello.ts',old_text:'"world"',new_text:'"RAIZ"'}};
  assert.match(await ws.execute(action, async()=>false),/RECUSADA/);
  assert.match(await fs.readFile(path.join(root,'src','hello.ts'),'utf8'),/world/);
  assert.match(await ws.execute(action, async()=>true),/Alterado/);
  assert.match(await fs.readFile(path.join(root,'src','hello.ts'),'utf8'),/RAIZ/);
  await assert.rejects(()=>ws.execute(action,async()=>true),/aparece 0/);
});

test('create_file cannot overwrite and needs explicit approval', async t => {
  const {ws,root} = await fixture(t);
  const action={type:'tool',tool:'create_file',args:{path:'src/new.ts',content:'export const n = 42;\n'}};
  assert.match(await ws.execute(action,async()=>false),/RECUSADA/);
  await assert.rejects(()=>fs.access(path.join(root,'src','new.ts')));
  assert.match(await ws.execute(action,async()=>true),/Criado/);
  await assert.rejects(()=>ws.execute(action,async()=>true),/EEXIST/);
});

test('command is blocked without approval', async t => {
  const {ws} = await fixture(t);
  const res = await ws.execute({type:'tool',tool:'run_command',args:{program:'node',argv:['--version']}},async()=>false);
  assert.match(res,/RECUSADO/);
});

test('undo restores the exact previous file after approved edit', async () => {
  const { Workspace } = await import('../dist/workspace.js');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chambinho-undo-'));
  try {
    await fs.writeFile(path.join(root, 'sample.txt'), 'before\n');
    const workspace = await Workspace.from(root);
    await workspace.execute({type:'tool',tool:'replace_text',args:{path:'sample.txt',old_text:'before',new_text:'after'}}, async()=>true);
    assert.equal(await fs.readFile(path.join(root,'sample.txt'),'utf8'),'after\n');
    assert.equal(await workspace.undoLast(),'Desfeito: sample.txt');
    assert.equal(await fs.readFile(path.join(root,'sample.txt'),'utf8'),'before\n');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('undo refuses to overwrite external modifications', async () => {
  const { Workspace } = await import('../dist/workspace.js');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chambinho-conflict-'));
  try {
    await fs.writeFile(path.join(root, 'sample.txt'), 'before');
    const workspace = await Workspace.from(root);
    await workspace.execute({type:'tool',tool:'replace_text',args:{path:'sample.txt',old_text:'before',new_text:'after'}}, async()=>true);
    await fs.writeFile(path.join(root,'sample.txt'),'external');
    await assert.rejects(workspace.undoLast(), /mudou/);
    assert.equal(await fs.readFile(path.join(root,'sample.txt'),'utf8'),'external');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('checkpoints survive process restart and undo safely', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chambinho-restart-'));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'chambinho-state-'));
  const previous = process.env.CHAMBINHO_STATE_DIR;
  process.env.CHAMBINHO_STATE_DIR = state;
  try {
    await fs.writeFile(path.join(root,'main.ts'),'const ok = false;\n');
    const first = await Workspace.from(root);
    await first.execute({type:'tool',tool:'replace_text',args:{path:'main.ts',old_text:'false',new_text:'true'}},async()=>true);
    const second = await Workspace.from(root);
    assert.equal(second.checkpointCount(),1);
    assert.match(await second.undoLast(),/Desfeito/);
    assert.equal(await fs.readFile(path.join(root,'main.ts'),'utf8'),'const ok = false;\n');
    assert.equal((await Workspace.from(root)).checkpointCount(),0);
  } finally {
    if (previous === undefined) delete process.env.CHAMBINHO_STATE_DIR;
    else process.env.CHAMBINHO_STATE_DIR = previous;
    await fs.rm(root,{recursive:true,force:true});
    await fs.rm(state,{recursive:true,force:true});
  }
});
