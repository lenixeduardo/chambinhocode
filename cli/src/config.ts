import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {GatewayClient} from './gateway.js';

type Prompt = {ask(question:string):Promise<string>};
export type CliSettings = {gatewayUrl: string; clientKey: string; route: string};
const file = path.join(os.homedir(), '.chambinho', 'config.json');
const defaultUrl = 'http://127.0.0.1:8000';

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
    clientKey: (hasKey(process.env.CHAMBINHO_CLIENT_KEY || '') ? process.env.CHAMBINHO_CLIENT_KEY : '') || (hasKey(process.env.RAIZ_CLIENT_KEY || '') ? process.env.RAIZ_CLIENT_KEY : '') || disk.clientKey || '',
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
    return 'Conexão e autenticação confirmadas.';
  } catch (error) {
    return 'Não foi possível alcançar o gateway: ' + (error as Error).message;
  } finally {clearTimeout(timeout);}
}

export async function setup(ui: Prompt, initial: CliSettings): Promise<CliSettings> {
  process.stdout.write('\nCHAMBINHO — Configuração de acesso\n');
  const address = (await ui.ask('URL do gateway [' + initial.gatewayUrl + ']: ')).trim() || initial.gatewayUrl;
  process.stdout.write('A chave será exibida enquanto você digita; evite compartilhar a tela.\n');
  const entered = (await ui.ask('Chave do cliente (Enter mantém a atual): ')).trim();
  const key = entered || initial.clientKey;
  const route = (await ui.ask('Rota [code/fast/smart] [' + initial.route + ']: ')).trim() || initial.route;
  const next = {gatewayUrl:address,clientKey:key,route};
  if (!hasKey(key)) throw new Error('A chave precisa ter pelo menos 24 caracteres e não pode ser o placeholder.');
  await saveSettings(next);
  process.stdout.write('Configuração gravada em ' + file + '.\n');
  process.stdout.write((await probe(next)) + '\n');
  return next;
}
