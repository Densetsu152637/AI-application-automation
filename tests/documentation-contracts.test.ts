import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const docs = join(root, 'docs');
const markdown = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? markdown(path) : entry.name.endsWith('.md') ? [path] : [];
});

test('documentation links, requirement IDs, acceptance references, and JSON examples are valid', () => {
  const files = markdown(docs);
  const content = new Map(files.map(file => [file, readFileSync(file, 'utf8')]));
  const ids = new Map<string, string>();
  const references = new Set<string>();

  for (const [file, text] of content) {
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      const target = match[1]!;
      if (/^(https?:|mailto:)/.test(target)) continue;
      assert.ok(content.has(resolve(join(file, '..'), target)), `${file} links to missing ${target}`);
    }
    for (const match of text.matchAll(/^#{1,6}\s+((?:PROD|QA|ARCH|DATA|DEP|API|DISC|RES|AGENT|APP)-\d{3})\b/gm)) {
      assert.equal(ids.has(match[1]!), false, `duplicate requirement ${match[1]} in ${file}`);
      ids.set(match[1]!, file);
    }
    for (const match of text.matchAll(/\b((?:PROD|QA|ARCH|DATA|DEP|API|DISC|RES|AGENT|APP)-\d{3})\b/g)) references.add(match[1]!);
    for (const match of text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
      assert.doesNotThrow(() => JSON.parse(match[1]!), `${file} contains invalid JSON example`);
    }
  }

  for (const id of references) assert.ok(ids.has(id), `documentation references undefined requirement ${id}`);
  assert.ok(files.length >= 10, 'the ten-chapter documentation package is incomplete');
});
