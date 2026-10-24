import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GatewayClient } from '../dist/gateway.js';

const KEY='examplekey_examplekey_examplekey_examplekey';
test('GatewayClient sends a chat request to an authenticated gateway endpoint', async t => {
  let received;
  const server=http.createServer(async(req,res)=>{
    let data=''; for await(const part of req) data+=part.toString('utf8');
    received={url:req.url,auth:req.headers.authorization,body:JSON.parse(data)};
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({id:'a1',content:'Aprovado',provider:'groq',model:'fake',route:'code',usage:{total_tokens:20}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  const client=new GatewayClient(`http://127.0.0.1:${port}`,KEY);
  const resp=await client.chat('code',[{role:'user',content:'olá'}]);
  assert.equal(resp.content,'Aprovado');
  assert.equal(received.auth,`Bearer ${KEY}`);
  assert.equal(received.url,'/v1/chat');
  assert.equal(received.body.route,'code');
  assert.equal(received.body.messages[0].content,'olá');
});

test('GatewayClient forbids unencrypted remote hosts and rejects weak keys', async () => {
  assert.throws(()=>new GatewayClient('http://example.com','whatever'),/HTTPS/);
  const client=new GatewayClient('http://127.0.0.1:8000','short');
  await assert.rejects(()=>client.chat('code',[{role:'user',content:'x'}]),/CHAMBINHO_CLIENT_KEY/);
});
