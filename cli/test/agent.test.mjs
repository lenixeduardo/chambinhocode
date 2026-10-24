import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAction, Agent } from '../dist/agent.js';
import { Workspace } from '../dist/workspace.js';

class ScriptedModel {
  constructor(...responses) {this.responses = responses;this.calls = [];}
  async chat(route,messages) {
    this.calls.push({route,messages});
    return {content:this.responses.shift() ?? '{"type":"final","message":"sem passos"}',provider:'fake',model:'fake-model'};
  }
}

test('JSON and markdown code fences parse correctly', () => {
  assert.equal(parseAction('{"type":"final","message":"ok"}').message,'ok');
  assert.equal(parseAction('```json\n{"type":"final","message":"bom"}\n```').message,'bom');
  assert.equal(parseAction('Resposta em linguagem natural').message,'Resposta em linguagem natural');
  assert.throws(()=>parseAction('{"type":"tool","tool":"delete_file","args":{}}'));
});

test('agent can read and report without modifying files', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'raiz-agent-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'index.ts'),'console.log("olá")');
  const model = new ScriptedModel(
    JSON.stringify({type:'tool',tool:'read_file',args:{path:'index.ts'},reason:'Inspecionar arquivo'}),
    JSON.stringify({type:'final',message:'Arquivo contém console.log.'})
  );
  const events=[];
  const agent=new Agent(model,await Workspace.from(root),'code',async()=>{throw new Error('approval should not be asked')},e=>events.push(e));
  const out=await agent.run('O que esse código faz?');
  assert.match(out,/console.log/);
  assert.equal(model.calls.length,2);
  assert.match(model.calls[1].messages.at(-1).content,/olá/);
  assert.equal(events.filter(e=>e.kind==='tool').length,1);
});

test('denied edits are not written, and final must acknowledge refusal', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'raiz-agent-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'file.txt'),'initial');
  const model=new ScriptedModel(
    JSON.stringify({type:'tool',tool:'replace_text',args:{path:'file.txt',old_text:'initial',new_text:'modified'}}),
    JSON.stringify({type:'final',message:'Edição recusada.'})
  );
  const agent=new Agent(model,await Workspace.from(root),'code',async()=>false);
  assert.equal(await agent.run('modifique'), 'Edição recusada.');
  assert.equal(await fs.readFile(path.join(root,'file.txt'),'utf8'),'initial');
});

test('banner is available even without a running gateway', () => {
  const cli=new URL('../dist/index.js',import.meta.url);
  const result=cp.spawnSync(process.execPath,[fileURLToPath(cli),'--banner'],{encoding:'utf8',env:{...process.env,NO_COLOR:'1'}});
  assert.equal(result.status,0);
  assert.match(result.stdout,/C H A M B I N H O/);
  assert.match(result.stdout,/o/);
});


test('Chambinho mascot consists only of authored printable ASCII characters', async () => {
  const { CHAMBINHO_ASCII, terminalMascot } = await import('../dist/terminal.js');
  assert.match(CHAMBINHO_ASCII, /[Oo]/);
  assert.match(CHAMBINHO_ASCII, /[#]/);
  assert.doesNotMatch(CHAMBINHO_ASCII, /@/);
  assert.match(CHAMBINHO_ASCII, /\\____\//);
  assert.doesNotMatch(CHAMBINHO_ASCII, /[^\x0A\x20-\x7E]/);
  assert.doesNotMatch(CHAMBINHO_ASCII, /[▀▄█▓▒░]/u);
  assert.equal(terminalMascot().replace(/\x1b\[[0-9;]*m/g, ''), CHAMBINHO_ASCII);
});

test('ANSI colors decorate characters without replacing them with raster blocks', async () => {
  const cli = new URL('../dist/index.js', import.meta.url);
  const env = { ...process.env, FORCE_COLOR: '1' };
  delete env.NO_COLOR;
  const colored = cp.spawnSync(process.execPath, [fileURLToPath(cli), '--banner'], { encoding: 'utf8', env });
  assert.equal(colored.status, 0, colored.stderr);
  assert.match(colored.stdout, /\x1b\[38;2;/);
  const plain = cp.spawnSync(process.execPath, [fileURLToPath(cli), '--banner'], { encoding: 'utf8', env: {...env, NO_COLOR: '1'} });
  assert.equal(plain.status, 0, plain.stderr);
  const stripped = colored.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(stripped, plain.stdout);
});


test('edited files without successful validation are explicitly marked', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-verify-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'a.txt'),'old');
  const model=new ScriptedModel(
    JSON.stringify({type:'tool',tool:'replace_text',args:{path:'a.txt',old_text:'old',new_text:'new'}}),
    JSON.stringify({type:'final',message:'Pronto.'})
  );
  const agent=new Agent(model,await Workspace.from(root),'code',async()=>true);
  assert.match(await agent.run('edite'),/não validadas/);
});

test('successful approved test command validates a changed file', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-verify-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'a.txt'),'old');
  const model=new ScriptedModel(
    JSON.stringify({type:'tool',tool:'replace_text',args:{path:'a.txt',old_text:'old',new_text:'new'}}),
    JSON.stringify({type:'tool',tool:'run_command',args:{program:'node',argv:['--version']}}),
    JSON.stringify({type:'final',message:'Verificado.'})
  );
  const agent=new Agent(model,await Workspace.from(root),'code',async()=>true);
  assert.equal(await agent.run('edite e verifique'),'Verificado.');
});
