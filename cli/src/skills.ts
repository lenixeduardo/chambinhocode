import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_BYTES = 32_000;
function dirs(root: string) { return [path.join(root,'.chambinho','skills'),path.join(os.homedir(),'.chambinho','skills')]; }
function validate(name: string) { if (!NAME.test(name)) throw new Error('Nome de skill inválido.'); return name; }
export async function listSkills(root: string): Promise<{name:string;source:string}[]> {
  const found = new Map<string,string>();
  for (const folder of dirs(root)) {
    let entries; try { entries = await fs.readdir(folder,{withFileTypes:true}); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory() && NAME.test(entry.name) && !found.has(entry.name)) {
      try { const file=path.join(folder,entry.name,'SKILL.md'); const stat=await fs.lstat(file); if(stat.isFile() && stat.size <= MAX_BYTES) found.set(entry.name,folder); } catch { /* ignore incomplete skills */ }
    }
  }
  return [...found].map(([name,source])=>({name,source}));
}
export async function loadSkill(root: string,name: string): Promise<{name:string;content:string}> {
  validate(name);
  for (const folder of dirs(root)) {
    const file=path.join(folder,name,'SKILL.md');
    try {
      const stat=await fs.lstat(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('SKILL.md inválido ou maior que 32 KB.');
      return {name,content:await fs.readFile(file,'utf8')};
    } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  throw new Error(`Skill ${name} não encontrada.`);
}
export async function installSkill(root:string,source:string):Promise<string> {
  // Import only a local SKILL.md. No arbitrary scripts, network fetching or recursive copying.
  const resolved=path.resolve(root,source);
  const stat=await fs.lstat(resolved);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Informe um SKILL.md local com até 32 KB.');
  const name=validate(path.basename(path.dirname(resolved)));
  const content=await fs.readFile(resolved,'utf8');
  if (!content.trim()) throw new Error('SKILL.md vazio.');
  const dest=path.join(root,'.chambinho','skills',name);
  await fs.mkdir(dest,{recursive:true});
  await fs.writeFile(path.join(dest,'SKILL.md'),content,{flag:'wx',mode:0o600});
  return name;
}
