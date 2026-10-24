import readline from 'node:readline';
import process from 'node:process';

export type SlashItem = { command: string; description: string };
export const SLASH_ITEMS: SlashItem[] = [
  {command:'/menu',description:'Voltar ao menu inicial'},
  {command:'/help',description:'Ajuda e comandos'},
  {command:'/plan',description:'Planejar uma tarefa'},
  {command:'/audit',description:'Auditar o projeto'},
  {command:'/goal',description:'Implementar um objetivo'},
  {command:'/review',description:'Revisar código'},
  {command:'/fix',description:'Corrigir um problema'},
  {command:'/test',description:'Executar testes'},
  {command:'/visual',description:'Capturar e analisar página'},
  {command:'/parallel',description:'Executar subagentes em paralelo'},
  {command:'/agents',description:'Listar subagentes'},
  {command:'/agent',description:'Executar um subagente'},
  {command:'/skills',description:'Listar ou instalar skills'},
  {command:'/skill',description:'Executar uma skill'},
  {command:'/model',description:'Selecionar modelo/rota'},
  {command:'/status',description:'Status do projeto'},
  {command:'/undo',description:'Desfazer edição'},
  {command:'/clear',description:'Limpar conversa'},
  {command:'/save',description:'Salvar sessão'},
  {command:'/resume',description:'Restaurar sessão'},
  {command:'/exit',description:'Sair'}
];

export function matchingSlashItems(input: string): SlashItem[] {
  if (!input.startsWith('/') || input.includes(' ')) return [];
  const query = input.toLowerCase();
  return SLASH_ITEMS.filter(item => item.command.startsWith(query)).slice(0, 9);
}

/** Editor de uma linha com autocomplete de comandos para terminais ANSI (Git Bash incluso). */
export function openInteractivePrompt(): { ask: (question:string)=>Promise<string>; close:()=>void } {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = readline.createInterface({input:process.stdin,output:process.stdout});
    return {ask:(question)=>new Promise(resolve=>rl.question(question,resolve)),close:()=>rl.close()};
  }
  readline.emitKeypressEvents(process.stdin);
  const originalRaw = process.stdin.isRaw || false;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let activeCleanup: (()=>void) | undefined;
  let closed = false;
  const ask = (question:string):Promise<string> => {
    if (closed) return Promise.reject(new Error('Terminal fechado.'));
    return new Promise((resolve,reject)=>{
      let value = '';
      let selected = 0;
      let renderedLines = 0;
      let cursor = 0;
      const draw = () => {
        const matches = matchingSlashItems(value);
        selected = Math.min(selected, Math.max(0,matches.length-1));
        const lines = matches.length ? matches.map((item,i) =>
          (i===selected ? '\x1b[7m' : '') + '  ' + (i===selected?'❯':' ') + ' ' +
          item.command.padEnd(13) + item.description + (i===selected?'\x1b[0m':'')
        ) : [];
        // Retorna ao começo da área desenhada antes de reimprimir.
        if (renderedLines) process.stdout.write('\r' + '\x1b['+renderedLines+'A');
        process.stdout.write('\r\x1b[0J' + question + value + '\x1b[K');
        for (const line of lines) process.stdout.write('\n\r' + line + '\x1b[K');
        renderedLines = lines.length;
        if (renderedLines) process.stdout.write('\x1b['+renderedLines+'A\r\x1b['+(question.length+value.length)+'C');
      };
      const cleanup = () => {
        process.stdin.off('keypress',onKey);
        activeCleanup = undefined;
      };
      const finish = (answer:string) => {
        cleanup();
        // Limpa o menu antes de confirmar a linha digitada.
        if (renderedLines) process.stdout.write('\r\x1b[0J');
        process.stdout.write('\r\x1b[2K'+question+answer+'\n');
        resolve(answer);
      };
      const onKey = (str:string | undefined,key:{name?:string;ctrl?:boolean;meta?:boolean;sequence?:string}) => {
        if (key.ctrl && key.name==='c') { cleanup(); process.stdout.write('^C\n'); reject(new Error('Interrompido (Ctrl+C).')); return; }
        if (key.name==='return' || key.name==='enter') {
          const matches = matchingSlashItems(value);
          if (matches.length && value.startsWith('/') && !value.includes(' ')) {
            const choice = matches[selected].command;
            if (['/plan','/audit','/goal','/review','/fix','/test','/visual','/parallel','/agent','/skill','/model'].includes(choice)) { value=choice+' '; selected=0; draw(); }
            else finish(choice);
          } else finish(value);
          return;
        }
        if (key.name==='escape') { if(value.startsWith('/')) {value='';selected=0;draw();} return; }
        if (key.name==='up' || key.name==='down') {
          const matches=matchingSlashItems(value);
          if(matches.length) selected=(selected+(key.name==='down'?1:-1)+matches.length)%matches.length;
          draw();return;
        }
        if (key.name==='tab') {
          const matches=matchingSlashItems(value);
          if(matches.length) {value=matches[selected].command;selected=0;draw();}
          return;
        }
        if(key.name==='backspace') {value=value.slice(0,-1);selected=0;draw();return;}
        if(key.ctrl && key.name==='u') {value='';selected=0;draw();return;}
        if(key.ctrl || key.meta || !str || /[\x00-\x1f\x7f]/.test(str)) return;
        value+=str;selected=0;draw();
      };
      activeCleanup=cleanup;
      process.stdin.on('keypress',onKey);
      draw();
    });
  };
  return {ask,close:()=>{closed=true;activeCleanup?.();process.stdin.setRawMode(originalRaw);process.stdin.pause();}};
}
