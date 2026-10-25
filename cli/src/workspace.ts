import fs from 'node:fs/promises';
import path from 'node:path';
import cp from 'node:child_process';
import os from 'node:os';
import {createHash} from 'node:crypto';

const BLOCKED_DIRS = new Set(['.git', 'node_modules', '.next', '.venv', 'venv', 'dist', 'build', 'coverage', '.idea', '.cache']);
const SECRET_NAMES = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_(?:rsa|ed25519)|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|p12|pfx|key))$/i;
const MAX_READ_BYTES = 100_000;
const MAX_WRITE_BYTES = 300_000;
const MAX_SEARCH_FILES = 500;
const allowedPrograms = new Set(['npm','pnpm','yarn','npx','node','python','python3','pytest','tsc','ruff','cargo','go','git']);

export type ToolName = 'list_files' | 'read_file' | 'search_text' | 'git_status' | 'replace_text' | 'create_file' | 'run_command';
export type ToolAction = { type: 'tool'; tool: ToolName; args: Record<string, unknown>; reason?: string };
export type Approval = (summary: string) => Promise<boolean>;

function argString(args: Record<string, unknown>, key: string, fallback?: string): string {
  const value = args[key] === undefined ? fallback : args[key];
  if (typeof value !== 'string') throw new Error(`Argumento ${key} precisa ser texto.`);
  return value;
}
function displayPath(input: string): string { return input.split(path.sep).join('/'); }
function limited(input: string, max = 14000): string { return input.length > max ? input.slice(0, max) + '\n… [conteúdo truncado]' : input; }
function blockedPath(relative: string): boolean {
  return relative.split(/[\\/]/).some(p => BLOCKED_DIRS.has(p) || SECRET_NAMES.test(p));
}

export class Workspace {
  private checkpoints: Array<{file: string; previous: string | null; expected: string}> = [];
  private constructor(readonly root: string, private readonly stateFile: string) {}
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), {recursive:true, mode:0o700});
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({root:this.root, checkpoints:this.checkpoints.slice(-30)}), {mode:0o600});
    await fs.rename(tmp, this.stateFile);
  }
  private async remember(item: {file:string; previous:string|null; expected:string}): Promise<void> {
    this.checkpoints.push(item);
    await this.persist();
  }
  async undoLast(): Promise<string> {
    const item = this.checkpoints.at(-1);
    if (!item) return 'Nenhuma alteração nesta sessão para desfazer.';
    const full = await this.resolveFile(item.file, {allowNew: true});
    const current = await fs.readFile(full, 'utf8');
    if (current !== item.expected) throw new Error('Arquivo mudou depois da edição; desfazer cancelado.');
    if (item.previous === null) await fs.unlink(full);
    else await fs.writeFile(full, item.previous, 'utf8');
    this.checkpoints.pop();
    await this.persist();
    return `Desfeito: ${item.file}`;
  }
  checkpointCount(): number { return this.checkpoints.length; }
  static async from(root: string): Promise<Workspace> {
    // Running a globally linked CLI from its own /cli folder should operate
    // on the repository project, not on the nested package by accident.
    let canonical = await fs.realpath(root);
    if (path.basename(canonical).toLowerCase() === 'cli') {
      const parent = path.dirname(canonical);
      try {
        const marker = await fs.stat(path.join(parent, '.git'));
        if (marker.isDirectory() || marker.isFile()) canonical = parent;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const stateDir = process.env.CHAMBINHO_STATE_DIR || path.join(os.homedir(), '.chambinho', 'checkpoints');
    const file = path.join(stateDir, createHash('sha256').update(canonical).digest('hex') + '.json');
    const ws = new Workspace(canonical, file);
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8')) as {root?:string; checkpoints?:unknown};
      if (data.root !== canonical || !Array.isArray(data.checkpoints) || data.checkpoints.length > 30) throw new Error('Estado de checkpoints inválido.');
      for (const item of data.checkpoints) {
        if (!item || typeof item !== 'object') throw new Error('Checkpoint inválido.');
        const entry = item as Record<string, unknown>;
        if (typeof entry.file !== 'string' || (entry.previous !== null && typeof entry.previous !== 'string') || typeof entry.expected !== 'string') throw new Error('Checkpoint inválido.');
        if (entry.expected.length > MAX_WRITE_BYTES || (typeof entry.previous === 'string' && entry.previous.length > MAX_WRITE_BYTES)) throw new Error('Checkpoint excede tamanho permitido.');
        await ws.resolveFile(entry.file, {allowNew:true});
        ws.checkpoints.push({file:entry.file, previous:entry.previous as string|null, expected:entry.expected});
      }
    } catch(error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return ws;
  }

  async resolveFile(name: string, { allowNew = false, directory = false } = {}): Promise<string> {
    if (!name || name.includes('\0') || path.isAbsolute(name)) throw new Error('Caminho inválido ou absoluto.');
    const full = path.resolve(this.root, name);
    const rel = path.relative(this.root, full);
    if (rel === '..' || rel.startsWith('..' + path.sep)) throw new Error('Caminho fora do projeto.');
    if (blockedPath(rel)) throw new Error('Acesso bloqueado: arquivo sensível ou pasta ignorada.');
    const parent = directory ? full : path.dirname(full);
    // Check every existing component; do not follow symlinks, even inside the workspace.
    let current = this.root;
    for (const segment of path.relative(this.root, parent).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      let stat;
      try { stat = await fs.lstat(current); } catch (error) {
        if (allowNew && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error('Links simbólicos não são aceitos.');
    }
    try {
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error('Links simbólicos não são aceitos.');
      if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Tipo de caminho inesperado.');
    } catch (error) {
      if (!(allowNew && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
    }
    return full;
  }

  async listFiles(subpath = '.'): Promise<string> {
    const dir = await this.resolveFile(subpath, { directory: true });
    const stack: { dir: string; depth: number }[] = [{ dir, depth: 0 }];
    const found: string[] = [];
    while (stack.length && found.length < 180) {
      const { dir: current, depth } = stack.pop()!;
      for (const item of (await fs.readdir(current, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        const full = path.join(current, item.name);
        const rel = path.relative(this.root, full);
        if (blockedPath(rel) || item.isSymbolicLink()) continue;
        if (item.isDirectory() && depth < 3) stack.push({dir: full, depth: depth + 1});
        else if (item.isFile()) found.push(displayPath(rel));
        if (found.length >= 180) break;
      }
    }
    return `Arquivos (${found.length}, máximo 180):\n${found.sort().join('\n')}`;
  }

  async readFile(file: string): Promise<string> {
    const full = await this.resolveFile(file);
    const stat = await fs.stat(full);
    if (stat.size > MAX_READ_BYTES) throw new Error('Arquivo muito grande (>100KB).');
    const buffer = await fs.readFile(full);
    if (buffer.includes(0)) throw new Error('Arquivo binário não suportado.');
    return `${displayPath(path.relative(this.root, full))}:\n${limited(buffer.toString('utf8'), MAX_READ_BYTES)}`;
  }

  async searchText(phrase: string, inPath = '.'): Promise<string> {
    if (!phrase || phrase.length > 180) throw new Error('Busca inválida (1–180 caracteres).');
    const base = await this.resolveFile(inPath, { directory: true });
    const stack = [base];
    const results: string[] = [];
    let scanned = 0;
    while (stack.length && scanned < MAX_SEARCH_FILES && results.length < 35) {
      const next = stack.pop()!;
      for (const item of await fs.readdir(next, { withFileTypes: true })) {
        const full = path.join(next, item.name);
        if (blockedPath(path.relative(this.root, full)) || item.isSymbolicLink()) continue;
        if (item.isDirectory()) { stack.push(full); continue; }
        if (!item.isFile()) continue;
        scanned++;
        const stat = await fs.stat(full);
        if (stat.size > MAX_READ_BYTES) continue;
        const raw = await fs.readFile(full);
        if (raw.includes(0)) continue;
        const lines = raw.toString('utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(phrase.toLowerCase())) {
            results.push(`${displayPath(path.relative(this.root,full))}:${i+1}: ${limited(lines[i], 200)}`);
            if (results.length >= 35) break;
          }
        }
        if (scanned >= MAX_SEARCH_FILES || results.length >= 35) break;
      }
    }
    return results.length ? results.join('\n') : 'Nenhuma ocorrência no conteúdo. Para localizar pelo nome, use list_files.';
  }

  private async spawn(program: string, args: string[], timeout = 25_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {...process.env, GIT_TERMINAL_PROMPT: '0'};
      // Do not automatically leak the gateway's credentials to child commands.
      for (const secret of ['RAIZ_CLIENT_KEY', 'API_CLIENTS_JSON', 'GROQ_API_KEY', 'GEMINI_API_KEY',
                            'MISTRAL_API_KEY', 'NVIDIA_API_KEY', 'CHAMBINHO_CLIENT_KEY', 'CLOUDFLARE_API_TOKEN']) delete env[secret];
      const child = cp.spawn(program, args, { cwd: this.root, shell: false, windowsHide: true, env });
      let buffer = ''; let finished = false;
      const timer = setTimeout(() => { child.kill(); }, timeout);
      const append = (data: Buffer) => { buffer = limited(buffer + data.toString('utf8'), 18000); if (buffer.length >= 17990) child.kill(); };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.on('error', err => { if (!finished) { finished = true; clearTimeout(timer); reject(err); } });
      child.on('close', code => { if (!finished) { finished = true; clearTimeout(timer); resolve(`exit=${code}\n${buffer}`); } });
    });
  }

  async execute(action: ToolAction, approve: Approval): Promise<string> {
    const args = action.args;
    switch (action.tool) {
      case 'list_files': return this.listFiles(argString(args, 'path', '.'));
      case 'read_file': return this.readFile(argString(args, 'path'));
      case 'search_text': return this.searchText(argString(args,'query'), argString(args,'path','.'));
      case 'git_status': return this.spawn('git', ['status', '--short'], 10_000);
      case 'replace_text': {
        const filename = argString(args, 'path');
        const oldText = argString(args,'old_text'); const newText = argString(args,'new_text');
        if (!oldText || oldText === newText) throw new Error('Trecho original vazio ou sem alterações.');
        const full = await this.resolveFile(filename);
        const original = await fs.readFile(full, 'utf8');
        const count = original.split(oldText).length - 1;
        if (count !== 1) throw new Error(`Trecho original deveria aparecer uma vez, mas aparece ${count}.`);
        const updated = original.replace(oldText, newText);
        if (Buffer.byteLength(updated) > MAX_WRITE_BYTES) throw new Error('Resultado excede 300KB.');
        const summary = `DIFF ${filename}\n- ${limited(oldText, 3000).replace(/\n/g,"\n- ")}\n+ ${limited(newText, 3000).replace(/\n/g,"\n+ ")}`;
        if (!await approve(summary)) return 'ALTERAÇÃO RECUSADA PELO USUÁRIO. Não foi aplicado nada.';
        if (await fs.readFile(full,'utf8') !== original) throw new Error('Arquivo mudou durante aprovação; operação cancelada.');
        await fs.writeFile(full, updated, 'utf8');
        await this.remember({file: filename, previous: original, expected: updated});
        return `Alterado: ${filename} (1 ocorrência).`;
      }
      case 'create_file': {
        const filename = argString(args,'path'); const content = argString(args,'content');
        if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error('Arquivo excede 300KB.');
        const full = await this.resolveFile(filename, { allowNew: true });
        if (!await approve(`CRIAR ${filename}\n${limited(content, 1000)}`)) return 'CRIAÇÃO RECUSADA PELO USUÁRIO.';
        await fs.mkdir(path.dirname(full), {recursive:true});
        await this.resolveFile(filename, { allowNew:true });
        const handle = await fs.open(full, 'wx', 0o600);
        try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
        const confirmed = await fs.readFile(full, 'utf8');
        if (confirmed !== content) throw new Error('Arquivo criado, mas a verificação do conteúdo falhou.');
        await this.remember({file: filename, previous: null, expected: content});
        return `Criado e verificado: ${full} (${Buffer.byteLength(content)} bytes).`;
      }
      case 'run_command': {
        const program = argString(args,'program'); const argv = args.argv;
        if (!allowedPrograms.has(program)) throw new Error(`Executável ${program} não autorizado.`);
        if (!Array.isArray(argv) || argv.length > 20 || !argv.every(a=>typeof a === 'string' && a.length <= 200 && !a.includes('\0'))) throw new Error('argv deve ser uma lista de argumentos válidos.');
        const arr = argv as string[];
        if (program === 'git' && !['status','diff','log','branch','show'].includes(arr[0] ?? '')) throw new Error('Git restrito a comandos de leitura.');
        if (!await approve(`EXECUTAR: ${program} ${arr.join(' ')}`)) return 'COMANDO RECUSADO PELO USUÁRIO.';
        return this.spawn(program, arr);
      }
      default: throw new Error('Ferramenta desconhecida.');
    }
  }
}
