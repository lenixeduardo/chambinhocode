import {openInteractivePrompt} from './slash-menu.js';
import process from 'node:process';

const supportsColor = Boolean(process.stdout.isTTY || process.env.FORCE_COLOR === '1') && !('NO_COLOR' in process.env);
const color = (code: number, text: string): string => supportsColor ? `\x1b[${code}m${text}\x1b[0m` : text;
export const accent = (text: string) => color(31, text);
export const muted = (text: string) => color(90, text);

/** Small, manually authored ASCII heart, no graphics, no emoji, no block glyphs. */
export const CHAMBINHO_ASCII = String.raw`
       .--.     .--.
     .'####\___/####'.
    /####/OOOO\/OOOO\#\
   |####|OO  OO|OO  OO|##|
   |####|OOOOOO|OOOOOO|##|
 __|#####\OOOO/\OOOO/###|__
( _|########\____/######|_ )
 \_ \##################/ _/
     '.##############.'
       '-.########.-'
          '--##--'
           /  \
          /_  _\
         (__) (__)`;

// Color is optional: stripping ANSI yields the *same* complete character art.
const foreground: Record<string, string> = {
  '#': '234;40;59',   // red heart body
  '^': '91;41;28',    // brown tufts
  'O': '255;247;219', // cream eyes
};
const DEFAULT_RED = '231;49;72';
function colorizeCharacters(input: string): string {
  if (!supportsColor) return input;
  let output = '';
  let previous = '';
  for (const char of input) {
    if (char === '\n') { output += '\x1b[0m\n'; previous = ''; continue; }
    // Whitespace has no visible ink; avoid injecting escapes in padding.
    if (char === ' ') { output += char; continue; }
    const rgb = foreground[char] || DEFAULT_RED;
    if (rgb !== previous) { output += `\x1b[38;2;${rgb}m`; previous = rgb; }
    output += char;
  }
  return output + '\x1b[0m';
}

export function terminalMascot(): string {
  return colorizeCharacters(CHAMBINHO_ASCII);
}

export function banner(route: string, cwd: string): string {
  return `\n${terminalMascot()}\n\n ${color(91,'C H A M B I N H O')} ${muted('C O D E')}   ${muted('v0.12.0')}\n ${muted('Agente de programação · 100% ASCII')}\n ${muted(`projeto: ${cwd}  |  rota: ${route}`)}\n\n ${accent('1.')} Conversar           ${accent('2.')} Analisar projeto\n ${accent('3.')} Editar código       ${accent('4.')} Executar comandos\n ${accent('5.')} Configurações      ${accent('6.')} Sair\n ${muted('Digite um número, uma tarefa ou /menu para voltar aqui.')}\n`;
}
export type AskFn = (question: string) => Promise<string>;
export function openPrompt(): { ask: AskFn; close: () => void } {\n  return openInteractivePrompt();\n}
