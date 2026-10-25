import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {randomBytes} from 'node:crypto';
import {GatewayClient} from './gateway.js';

type Prompt = {ask(question:string, options?:{secret?:boolean}):Promise<string>};
export type CliSettings = {gatewayUrl: string; clientKey: string; route: string};
const file = path.join(os.homedir(), '.chambinho', 'config.json');
const defaultUrl = 'http://127.0.0.1:8000';
const localKeyFile = path.join(os.homedir(), '.chambinho', 'local-client.json');
const localGateway = (url:string) => { try {const parsed=new URL(url); return parsed.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);} catch {return false;} };

export async function ensureLocalKey(): Promise<string> {
  try { const data=JSON.parse(await fs.readFile(localKeyFile,'utf8')) as {key?:string}; if (hasKey(data.key || '')) return data.key!; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Arquivo de credencial local inválido; verifique ~/.chambinho/local-client.json.'); }
  await fs.mkdir(path.dirname(localKeyFile),{recursive:true,mode:0o700});
  const key=randomBytes(18).toString('base64url'); // Exactly 24 random characters (144 bits).
  try { await fs.writeFile(localKeyFile,JSON.stringify({key})+'\n',{flag:'wx',mode:0o600}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code==='EEXIST') return ensureLocalKey(); throw error; }
  if (process.platform !== 'win32') await fs.chmod(localKeyFile,0o600);
  return key;
}

export async function readSettings(): Promise<CliSettings> {
  let disk: Partial<CliSettings> = {};
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<CliSettings>;
    if (raw && typeof raw === 'object') disk = raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Configuração local inválida ou inacessível. Use chambinho setup para corrigir.');
  }
  return {
    gatewayUrl: process.env.CHAMBINHO_GATEWAY_URL || process.env.RAIZ_GATEWAY_URL || disk.gatewayUrl || defaultUrl,
    clientKey: (hasKey(process.env.CHAMBINHO_CLIENT_KEY || '') ? process.env.CHAMBINHO_CLIENT_KEY : '') || (hasKey(process.env.RAIZ_CLIENT_KEY || '') ? process.env.RAIZ_CLIENT_KEY : '') || (localGateway(process.env.CHAMBINHO_GATEWAY_URL || process.env.RAIZ_GATEWAY_URL || disk.gatewayUrl || defaultUrl) ? await ensureLocalKey() : disk.clientKey || ''),
    route: process.env.CHAMBINHO_ROUTE || process.env.RAIZ_ROUTE || disk.route || 'code'
  };
}

export async function saveSettings(settings: CliSettings) {
  // Secrets never belong in the repository or the project workspace.
  new GatewayClient(settings.gatewayUrl, settings.clientKey);
  if (!['fast','smart','code'].includes(settings.route)) throw new Error('Rota inválida.');
  const dir = path.dirname(file);
  await fs.mkdir(dir, {recursive:true,mode:0o700});
  // A private file is a fallback, not an OS credential vault; do not sync or share it.
  await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n', {mode:0o600});
  if (process.platform !== 'win32') await fs.chmod(file, 0o600);
}

export function hasKey(key: string) {
  return key.trim().length >= 24 && key !== 'SUA_CHAVE_DE_CLIENTE';
}

export async function probe(settings: CliSettings): Promise<string> {
  if (!hasKey(settings.clientKey)) return 'Chave ausente ou inválida; execute chambinho setup.';
  const client = new GatewayClient(settings.gatewayUrl, settings.clientKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(client.url + '/v1/routes', {
      headers: {Authorization:'Bearer ' + settings.clientKey}, signal:controller.signal
    });
    if (response.status === 401 || response.status === 403) return 'Chave rejeitada pelo gateway (HTTP ' + response.status + '). Execute chambinho setup.';
    if (!response.ok) return 'Gateway respondeu HTTP ' + response.status + '.';
    const data=await response.json() as {routes?:Record<string,Array<{provider?:string;configured?:boolean}>>};
    const available=data.routes?.[settings.route]?.filter(item=>item.configured).map(item=>item.provider).filter(Boolean) || [];
    if (!available.length) return 'Autenticado, mas nenhum provedor configurado na rota '+settings.route+'. Use chambinho setup.';
    return 'Conexão e autenticação confirmadas. Provedores disponíveis na rota '+settings.route+': '+available.join(', ')+'.';
  } catch (error) {
    return 'Não foi possível alcançar o gateway: ' + (error as Error).message;
  } finally {clearTimeout(timeout);}
}

const PROVIDERS = [
  {name:'Mistral', env:'MISTRAL_API_KEY'},
  {name:'Gemini', env:'GEMINI_API_KEY'},
  {name:'Groq', env:'GROQ_API_KEY'},
  {name:'NVIDIA', env:'NVIDIA_API_KEY'}
] as const;
const providerFile = path.join(os.homedir(), '.chambinho', 'providers.json');

export function parseProviderSelection(input:string): number[] {
  const selected = input.trim().toLowerCase();
  if (!selected || selected === '0') return [];
  if (selected === 'a' || selected === 'todos') return [0,1,2,3];
  const numbers = selected.split(/[ ,]+/).map(Number);
  if (!numbers.length || numbers.some(n=>!Number.isInteger(n)||n<1||n>4)) throw new Error('Escolha 1-4, separados por vírgula, a ou 0.');
  return [...new Set(numbers.map(n=>n-1))].sort();
}

export async function configureProviders(ui:Prompt):Promise<void> {
  process.stdout.write('\nSelecione os provedores (marque vários: 1,2,3,4):\n');
  for (let i=0;i<PROVIDERS.length;i++) process.stdout.write('  [ ] '+(i+1)+'. '+PROVIDERS[i].name+'\n');
  process.stdout.write('  [a] Todos  [0] Pular\n');
  const indices=parseProviderSelection(await ui.ask('Seleção: '));
  if (!indices.length) return;
  let existing:Record<string,string>={};
  try {
    const content=JSON.parse(await fs.readFile(providerFile,'utf8')) as Record<string,string>;
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Formato inválido');
    existing=content;
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Não foi possível ler o arquivo local de provedores.');
  }
  const next={...existing};
  for (const index of indices) {
    const provider=PROVIDERS[index];
    const previous=Boolean(existing[provider.env]);
    const entered=(await ui.ask('API key '+provider.name+(previous?' (Enter mantém a atual)':'')+': ',{secret:true})).trim();
    if (!entered && !previous) throw new Error('Chave de '+provider.name+' não informada; nenhuma alteração salva.');
    if (entered) next[provider.env]=entered;
  }
  await fs.mkdir(path.dirname(providerFile),{recursive:true,mode:0o700});
  const temporary=providerFile+'.tmp-'+process.pid;
  try {
    await fs.writeFile(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});
    await fs.rename(temporary,providerFile);
    if(process.platform!=='win32') await fs.chmod(providerFile,0o600);
  } finally {await fs.rm(temporary,{force:true}).catch(()=>{});}
  process.stdout.write('Provedores salvos no perfil local. As credenciais não foram exibidas.\n');
}

export async function setup(ui: Prompt, initial: CliSettings): Promise<CliSettings> {
  process.stdout.write('\nCHAMBINHO — Configuração de acesso\n');
  const address = (await ui.ask('URL do gateway [' + initial.gatewayUrl + ']: ')).trim() || initial.gatewayUrl;
  const key = localGateway(address) ? await ensureLocalKey() : (await ui.ask('Chave do gateway remoto: ')).trim() || initial.clientKey;
  if (localGateway(address)) process.stdout.write('Chave local de 24 caracteres gerada/recuperada automaticamente.\n');
  const route = ['code','fast','smart'].includes(initial.route) ? initial.route : 'code';
  process.stdout.write('Modo de IA: programação (code). Para alterar depois, use /model fast|smart|code.\n');
  const next = {gatewayUrl:address,clientKey:key,route};
  if (!hasKey(key)) throw new Error('A chave precisa ter pelo menos 24 caracteres e não pode ser o placeholder.');
  await saveSettings(next);
  if (localGateway(address)) await configureProviders(ui);
  process.stdout.write('Configuração gravada em ' + file + '.\n');
  process.stdout.write((await probe(next)) + '\n');
  return next;
}
