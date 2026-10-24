import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {AgentEvent} from './agent.js';
import {ModelClient} from './gateway.js';
import {Workspace, Approval} from './workspace.js';
import {SubagentCoordinator, SubagentRole} from './subagents.js';

export type ParallelTask = {role:SubagentRole; task:string};
export type ParallelResult = {role:SubagentRole; task:string; report:string; changes:string[]; conflicts:string[]; error?:string};
const IGNORE = new Set(['.git','.env','.venv','venv','node_modules','dist','build','coverage','.next','.chambinho']);
const SECRET = /^(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_(rsa|ed25519)|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(pem|p12|pfx|key))$/i;
const MAX_FILES=350, MAX_BYTES=3_000_000;
function digest(value:string|null):string|null {return value===null?null:createHash('sha256').update(value).digest('hex');}
async function snapshot(root:string):Promise<Map<string,string>> {
  const result=new Map<string,string>(); let bytes=0;
  async function walk(dir:string,level:number):Promise<void> {
    if(level>7)return;
    for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      if(IGNORE.has(entry.name)||SECRET.test(entry.name)||entry.isSymbolicLink())continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){await walk(full,level+1);continue;}
      if(!entry.isFile())continue;
      const stat=await fs.stat(full);
      if(stat.size>300_000)continue;
      bytes+=stat.size;
      if(bytes>MAX_BYTES||result.size>=MAX_FILES)throw new Error('Projeto excede limites de isolamento paralelo (350 arquivos/3 MB).');
      const raw=await fs.readFile(full);if(raw.includes(0))continue;
      result.set(path.relative(root,full).split(path.sep).join('/'),raw.toString('utf8'));
    }
  }
  await walk(root,0);return result;
}
async function readOptional(root:string,relative:string):Promise<string|null>{try{return await fs.readFile(path.join(root,relative),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}

/** Each worker receives a private filesystem snapshot. No worker writes to the live project.
 * Reconciliation uses optimistic content checks, and all live changes need human approval. */
export class ParallelCoordinator {
  constructor(private client:ModelClient,private workspace:Workspace,private route:string,private approve:Approval,
    private emit:(event:AgentEvent)=>void=()=>{}){}
  async run(tasks:ParallelTask[]):Promise<ParallelResult[]> {
    if(tasks.length<1||tasks.length>4)throw new Error('Use entre 1 e 4 tarefas paralelas.');
    if(tasks.some(t=>!['planner','implementer','auditor'].includes(t.role)||!t.task.trim()))throw new Error('Tarefa ou papel inválido.');
    const base=await snapshot(this.workspace.root);
    const staging=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-parallel-'));
    try {
      const results=await Promise.all(tasks.map(async(t,i):Promise<ParallelResult & {delta:Map<string,string|null>}>=>{
        const root=path.join(staging,`worker-${i}`);await fs.mkdir(root);
        for(const [name,content] of base){const dest=path.join(root,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,content);}
        try {
          const ws=await Workspace.from(root);
          const coordinator=new SubagentCoordinator(this.client,ws,this.route,this.approve,e=>{
            if(e.kind!=='delta')this.emit({...e,text:`[worker ${i+1} ${t.role}] ${e.text}`});
          });
          const report=await coordinator.runRole(t.role,t.task);
          const after=await snapshot(root);const delta=new Map<string,string|null>();
          for(const name of new Set([...base.keys(),...after.keys()])){
            const before=base.get(name)??null,now=after.get(name)??null;
            if(digest(before)!==digest(now))delta.set(name,now);
          }
          return {role:t.role,task:t.task,report,changes:[],conflicts:[],delta};
        }catch(e){return {role:t.role,task:t.task,report:'',changes:[],conflicts:[],error:(e as Error).message,delta:new Map()};}
      }));
      const owners=new Map<string,number[]>();
      results.forEach((r,i)=>{for(const file of r.delta.keys())owners.set(file,[...(owners.get(file)||[]),i]);});
      // Do not attempt to merge any file written by more than one worker.
      for(let i=0;i<results.length;i++){
        const r=results[i];
        for(const [file,content] of r.delta){
          if((owners.get(file)?.length||0)>1){r.conflicts.push(`${file}: alterado por múltiplos agentes`);continue;}
          if(content===null){r.conflicts.push(`${file}: exclusão não suportada`);continue;}
          const original=base.get(file)??null;
          const live=await readOptional(this.workspace.root,file);
          if(digest(live)!==digest(original)){r.conflicts.push(`${file}: projeto alterado desde o snapshot`);continue;}
          try{
            const action=original===null
              ? {type:'tool' as const,tool:'create_file' as const,args:{path:file,content}}
              : {type:'tool' as const,tool:'replace_text' as const,args:{path:file,old_text:original,new_text:content}};
            if(original===content)continue;
            if(original===''){r.conflicts.push(`${file}: arquivo original vazio requer merge manual`);continue;}
            const response=await this.workspace.execute(action,this.approve);
            if(response.startsWith('Criado:')||response.startsWith('Alterado:'))r.changes.push(file);
            else r.conflicts.push(`${file}: não aplicado (${response})`);
          }catch(e){r.conflicts.push(`${file}: ${(e as Error).message}`);}
        }
      }
      return results.map(({delta,...r})=>r);
    }finally{await fs.rm(staging,{recursive:true,force:true});}
  }
}
