#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import { banner, muted, openPrompt } from './terminal.js';
import { GatewayClient } from './gateway.js';
import { Workspace } from './workspace.js';
import { Agent, AgentEvent } from './agent.js';

const HELP = `Chambinho Code — agente de código no terminal

Uso:
  chambinho                        abrir conversa interativa
  chambinho "analise os testes"    executar tarefa única (somente leitura sem TTY)
  chambinho -p "explique src/"     prompt único
  chambinho --route smart          selecionar rota fast, smart ou code
  chambinho doctor                 diagnosticar configuração
  chambinho --banner               mostrar logotipo no terminal

Dentro da conversa:
  :help      ajuda
  :route X   selecionar rota (fast, smart, code)
  :status    mostrar status e pasta do projeto
  :clear     apagar histórico da conversa
  :save      salvar sessão localmente
  :resume    restaurar sessão salva
  :undo      desfazer última edição, inclusive após reiniciar
  :exit      sair

Configuração (variáveis de ambiente):
  CHAMBINHO_GATEWAY_URL   ex.: http://127.0.0.1:8000
  CHAMBINHO_CLIENT_KEY    token secreto configurado em API_CLIENTS_JSON
  CHAMBINHO_ROUTE         rota padrão: code

Segurança: sem autorização automática para escrita ou execução. Em modo não
interativo essas ações são recusadas. Não coloque credenciais no prompt.
`;

function eventText(event: AgentEvent) {
  if (event.kind === 'delta' && process.stdout.isTTY) process.stdout.write('.');
  if (event.kind === 'plan') process.stdout.write(`\nPlano:\n${event.text}\n`);
  if (event.kind === 'tool') process.stdout.write(`  → ${event.text}\n`);
  if (event.kind === 'result') process.stdout.write(`    ${event.text.replace(/\n/g, '\n    ')}\n`);
  if (event.kind === 'error') process.stdout.write(`  ! ${event.text}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  if (argv.includes('--version') || argv.includes('-v')) { process.stdout.write('Chambinho Code 0.8.0\n'); return; }
  let route = process.env.CHAMBINHO_ROUTE || process.env.RAIZ_ROUTE || 'code';
  const routeIndex = argv.indexOf('--route');
  if (routeIndex >= 0) {
    route = argv[routeIndex + 1] || '';
    argv.splice(routeIndex, 2);
  }
  if (!['code','fast','smart'].includes(route)) throw new Error('Rota inválida; use fast, smart ou code.');
  if (argv.includes('--banner')) { process.stdout.write(banner(route, process.cwd())); return; }
  const server = process.env.CHAMBINHO_GATEWAY_URL || process.env.RAIZ_GATEWAY_URL || 'http://127.0.0.1:8000';
  if (argv[0] === 'doctor') {
    process.stdout.write(banner(route, process.cwd()));
    process.stdout.write(`Node ${process.version}\nGateway: ${server}\n`);
    process.stdout.write(`CHAMBINHO_CLIENT_KEY: ${(process.env.CHAMBINHO_CLIENT_KEY || process.env.RAIZ_CLIENT_KEY) && ((process.env.CHAMBINHO_CLIENT_KEY || process.env.RAIZ_CLIENT_KEY) || '').length >= 24 ? 'configurada' : 'ausente ou inválida'}\n`);
    try {
      const client = new GatewayClient(server, (process.env.CHAMBINHO_CLIENT_KEY || process.env.RAIZ_CLIENT_KEY) || '');
      const controller = new AbortController(); const timeout = setTimeout(()=>controller.abort(),3500);
      try {
        const resp = await fetch(`${client.url}/health`, {signal:controller.signal});
        process.stdout.write(`Health: HTTP ${resp.status}\n`);
        if (resp.ok && (process.env.CHAMBINHO_CLIENT_KEY || process.env.RAIZ_CLIENT_KEY)) {
          const routes = await fetch(`${client.url}/v1/routes`, {signal:controller.signal,headers:{Authorization:`Bearer ${(process.env.CHAMBINHO_CLIENT_KEY || process.env.RAIZ_CLIENT_KEY)}`}});
          process.stdout.write(`Autenticação: HTTP ${routes.status}\n`);
          if (routes.ok) {
            const body = await routes.json() as {routes?:Record<string,Array<{provider:string;configured:boolean}>>};
            const configured = body.routes?.[route]?.filter(t => t.configured).map(t => t.provider) || [];
            process.stdout.write(`Provedores configurados na rota ${route}: ${configured.join(', ') || 'nenhum'}\n`);
          }
        }
      }
      finally { clearTimeout(timeout); }
    } catch(error) { process.stdout.write(`Health: indisponível (${(error as Error).message})\n`); }
    return;
  }
  let prompt = '';
  const pIndex = argv.indexOf('-p');
  if (pIndex >= 0) prompt = argv.slice(pIndex+1).join(' ');
  else if (argv.length) prompt = argv.join(' ');
  const interactive = !prompt;
  if (interactive && !process.stdin.isTTY) {
    throw new Error('Modo interativo requer terminal (TTY); use chambinho -p "sua tarefa".');
  }
  const workspace = await Workspace.from(process.cwd());
  const client = new GatewayClient(server, (process.env.CHAMBINHO_CLIENT_KEY || process.env.RAIZ_CLIENT_KEY) || '');
  const ui = interactive ? openPrompt() : null;
  const approve = async (summary: string): Promise<boolean> => {
    process.stdout.write(`\n${muted('Solicitação de permissão:')}\n${summary}\n`);
    if (!ui) { process.stdout.write('  Recusado: modo não interativo.\n'); return false; }
    const answer = (await ui.ask('Autorizar esta ação? [s/N] ')).trim().toLowerCase();
    return answer === 's' || answer === 'sim';
  };
  const agent = new Agent(client, workspace, route, approve, eventText);
  const sessionPath = path.join(os.homedir(), '.chambinho', 'sessions', createHash('sha256').update(workspace.root).digest('hex') + '.json');
  const saveSession = async () => { await fs.mkdir(path.dirname(sessionPath), {recursive:true, mode:0o700}); await fs.writeFile(sessionPath, JSON.stringify({root:workspace.root, route:agent.route, history:agent.exportHistory()}), {mode:0o600}); return 'Sessão salva localmente.'; };
  const resumeSession = async () => { const data = JSON.parse(await fs.readFile(sessionPath,'utf8')); if(data.root !== workspace.root) throw new Error('Projeto incompatível.'); agent.importHistory(data.history); if(['fast','smart','code'].includes(data.route)) agent.route=data.route; return 'Sessão restaurada.'; };
  try {
    if (!interactive) { process.stdout.write(`\n${await agent.run(prompt)}\n`); return; }
    process.stdout.write(banner(route, workspace.root));
    for (;;) {
      const input = (await ui!.ask('\n❯ ')).trim();
      if (!input) continue;
      if (input === '6') return;
      if (input === '5') { process.stdout.write('Comandos: :route fast|smart|code, :status, :clear, :help, :exit\n'); continue; }
      const menuTasks: Record<string,string> = {
        '1': 'Converse comigo sobre este projeto. Apresente-se brevemente e pergunte como pode ajudar.',
        '2': 'Analise a estrutura e os arquivos principais deste projeto, destacando problemas e melhorias.',
        '3': 'Analise o projeto e sugira uma melhoria de código. Solicite aprovação antes de editar.',
        '4': 'Inspecione as verificações disponíveis neste projeto. Solicite aprovação antes de executar comandos.'
      };
      const task = menuTasks[input] || input;
      if ([':exit',':quit','/exit'].includes(input)) return;
      if (input === ':help') { process.stdout.write(HELP); continue; }
      if (input === ':save') { process.stdout.write(await saveSession() + '\n'); continue; }
      if (input === ':resume') { try { process.stdout.write(await resumeSession() + '\n'); } catch(e) { process.stderr.write((e as Error).message + '\n'); } continue; }
      if (input === ':undo') { try { process.stdout.write(await workspace.undoLast() + '\n'); } catch(e) { process.stderr.write((e as Error).message + '\n'); } continue; }
      if (input === ':clear') { agent.reset(); process.stdout.write('Histórico limpo.\n'); continue; }
      if (input === ':status') { process.stdout.write(`Projeto: ${workspace.root}\nRota: ${agent.route}\nCheckpoints: ${workspace.checkpointCount()}\nGateway: ${server}\n`); continue; }
      if (input.startsWith(':route ')) {
        const target = input.slice(7).trim();
        if (!['code','fast','smart'].includes(target)) process.stdout.write('Rotas: code | fast | smart\n');
        else { agent.route = target; process.stdout.write(`Rota alterada: ${target}\n`); }
        continue;
      }
      try { const answer = await agent.run(task); process.stdout.write(`\n${answer}\n`); }
      catch (error) { process.stderr.write(`Erro: ${(error as Error).message}\n`); }
    }
  } finally { ui?.close(); }
}

main().catch(error => { process.stderr.write(`CHAMBINHO: ${(error as Error).message}\n`); process.exitCode = 1; });
