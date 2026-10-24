import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOKEN='integration_key_for_raiz_code_test_123456';

test('end-to-end: CLI -> gateway HTTP -> agent reads local project -> final response', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'raiz-e2e-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'hello.js'),'console.log("raiz");\n');
  let calls=0;
  const scripted=[
    {type:'tool',tool:'read_file',args:{path:'hello.js'},reason:'Abrindo código'},
    {type:'final',message:'O código exibe a palavra raiz.'}
  ];
  const server=http.createServer(async(req,res)=>{
    if(req.url!=='/v1/chat'){res.writeHead(404);res.end();return;}
    assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);
    let data=''; for await(const part of req) data+=part;
    const payload=JSON.parse(data);
    assert.equal(payload.route,'code');
    if(calls===1) assert.match(JSON.stringify(payload.messages), /console.log/);
    const action=scripted[calls++] || scripted.at(-1);
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({content:JSON.stringify(action),model:'fake-code-model',provider:'test'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const cli=new URL('../dist/index.js',import.meta.url);
  const output=await new Promise((resolve,reject)=>{
    const child=cp.spawn(process.execPath,[fileURLToPath(cli),'-p','Explique hello.js'],{cwd:root,env:{...process.env,CHAMBINHO_CLIENT_KEY:TOKEN,CHAMBINHO_GATEWAY_URL:`http://127.0.0.1:${server.address().port}`,NO_COLOR:'1'}});
    let stdout='',stderr='';
    child.stdout.on('data',d=>stdout+=d);
    child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);
    child.on('close',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(output.code,0,output.stderr);
  assert.equal(calls,2);
  assert.match(output.stdout,/→ read_file/);
  assert.match(output.stdout,/O código exibe a palavra raiz/);
});
