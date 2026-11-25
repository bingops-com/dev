import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGateway, routeHost } from '../server.mjs';

async function fixture(t, projectHandler = (req,res) => res.end('project')) {
  let data;
  const project = http.createServer(projectHandler); project.listen(0,'127.0.0.1'); await once(project,'listening');
  const port = project.address().port;
  data = {ports:[{port,project:'fixture',runtime:'Node.js'}],projects:[{name:'fixture',ports:[port]}]};
  const agent = http.createServer((req,res) => { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify(data)); });
  agent.listen(0,'127.0.0.1'); await once(agent,'listening');
  const gateway = createGateway({agentPort:agent.address().port,inventoryCacheMs:0});
  gateway.listen(0,'127.0.0.1'); await once(gateway,'listening');
  t.after(() => { for (const server of [gateway,agent,project]) { server.closeAllConnections(); server.close(); } });
  const request = (host = 'dev.lab.bingo', path = '/', headers = {}, method = 'GET', body = '') => new Promise((resolve,reject) => {
    const req = http.request({hostname:'127.0.0.1',port:gateway.address().port,path,method,headers:{host,'x-authentik-username':'bingops',...headers}}, res => {
      let body=''; res.on('data',part=>body+=part); res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));
    }); req.on('error',reject); req.end(body);
  });
  return {port,project,agent,gateway,request,setData:value=>{data=value;}};
}

test('accepts only short, nonprivileged port aliases', () => {
  assert.equal(routeHost('4173.dev.lab.bingo').port,4173);
  for (const host of ['22.dev.lab.bingo','65536.dev.lab.bingo','04173.dev.lab.bingo','4173.evil.test','4173--main--lab--bingops.dev.lab.bingo','dev.lab.bingo']) assert.equal(routeHost(host),null);
});
test('requires the configured SSO owner for inventory, files and projects', async t => {
  const f = await fixture(t);
  for (const host of ['dev.lab.bingo',`${f.port}.dev.lab.bingo`]) {
    for (const identity of ['', 'other']) assert.equal((await f.request(host,'/',{'x-authentik-username':identity})).status,401);
  }
  assert.equal((await f.request('dev.lab.bingo','/api/workspace')).status,200);
  assert.equal((await f.request('dev.lab.bingo','/api/workspace',{},'POST')).status,405);
});
test('forwards project HTTP and preserves app origin while removing SSO credentials', async t => {
  let seen;
  const f = await fixture(t,async(req,res)=>{let body='';for await(const p of req)body+=p;seen={headers:req.headers,body,path:req.url,method:req.method};res.end('ok');});
  const host=`${f.port}.dev.lab.bingo`;
  const response=await f.request(host,'/api?q=1',{origin:`https://${host}`,cookie:'authentik_proxy_token=private; app=value',authorization:'Bearer app-token-fixture'},'POST','payload');
  assert.equal(response.status,200);assert.equal(seen.headers.host,host);assert.equal(seen.headers.origin,`https://${host}`);assert.equal(seen.body,'payload');assert.equal(seen.method,'POST');assert.equal(seen.path,'/api?q=1');
  assert.equal(seen.headers['x-authentik-username'],undefined);assert.equal(seen.headers.authorization,'Bearer app-token-fixture');assert.equal(seen.headers.cookie.trim(),'app=value');
});
test('refuses ports outside discovery and fails closed on invalid inventory', async t => {
  const f=await fixture(t);f.setData({ports:[],projects:[]});
  assert.equal((await f.request(`${f.port}.dev.lab.bingo`)).status,404);
  f.setData({ports:[{port:22,project:'bad'}],projects:[]});
  assert.equal((await f.request(`${f.port}.dev.lab.bingo`)).status,503);
  assert.equal((await f.request('dev.lab.bingo','/api/workspace')).status,503);
});
test('WebSocket upgrades use only discovered ports and retain authentication checks', async t => {
  const f=await fixture(t);const host=`${f.port}.dev.lab.bingo`;
  f.project.on('upgrade',(req,socket)=>{assert.equal(req.headers['x-authentik-username'],undefined);socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');socket.on('data',p=>socket.write(p));socket.on('end',()=>socket.end());});
  await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:f.gateway.address().port,path:'/socket',headers:{host,'x-authentik-username':'bingops',connection:'Upgrade',upgrade:'websocket'}});req.on('upgrade',(_,socket)=>{socket.on('error',reject);socket.once('data',data=>{assert.equal(data.toString(),'ping');socket.destroy();resolve();});socket.write('ping');});req.on('error',reject);req.end();});
  const refused=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:f.gateway.address().port,path:'/socket',headers:{host,connection:'Upgrade',upgrade:'websocket'}});req.on('response',res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(refused,401);
});
