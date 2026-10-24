import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {listSkills,loadSkill,installSkill} from '../dist/skills.js';

test('install, list and load a local SKILL.md', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chambinho-skill-'));
 try {
  const source=path.join(root,'source','audit');
  await fs.mkdir(source,{recursive:true});
  await fs.writeFile(path.join(source,'SKILL.md'),'# Audit\nCheck tests.');
  assert.equal(await installSkill(root,'source/audit/SKILL.md'),'audit');
  assert.ok((await listSkills(root)).some(s=>s.name==='audit'));
  assert.match((await loadSkill(root,'audit')).content,/Check tests/);
  await assert.rejects(installSkill(root,'source/audit/SKILL.md'),/EEXIST/);
  await assert.rejects(loadSkill(root,'../secret'),/inválido/);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
