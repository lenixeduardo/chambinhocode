import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingSlashItems} from '../dist/slash-menu.js';

test('barra isolada abre comandos',()=>{const items=matchingSlashItems('/');assert.ok(items.length>1);assert.ok(items.some(x=>x.command==='/menu'));});
test('filtra por prefixo',()=>{const items=matchingSlashItems('/vis');assert.deepEqual(items.map(x=>x.command),['/visual']);});
test('argumentos encerram o menu',()=>{assert.deepEqual(matchingSlashItems('/goal criar página'),[]);});
test('texto comum não abre o menu',()=>{assert.deepEqual(matchingSlashItems('analisar projeto'),[]);});
