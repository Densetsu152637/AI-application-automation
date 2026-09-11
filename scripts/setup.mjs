import { mkdirSync, writeFileSync, copyFileSync, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const dir of ['.secrets', 'resources', 'output']) mkdirSync(dir, { recursive: true });
for (const name of ['internal']) {
  try { writeFileSync(`.secrets/${name}.txt`, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}
try { copyFileSync('.env.example', '.env', constants.COPYFILE_EXCL); }
catch (e) { if (e.code !== 'EEXIST') throw e; }
console.log('Local directories, separate secrets and environment are ready. Existing files were preserved.');
