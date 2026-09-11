import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(process.cwd(), 'services', 'inference');
const source = readFileSync(join(root, 'server.py'), 'utf8');

test('Unsloth inference loads lazily and unloads idle model memory', () => {
  assert.match(source, /load_model\(\)/);
  assert.match(source, /unload_model\(\)/);
  assert.match(source, /MODEL_IDLE_SECONDS/);
  assert.match(source, /asyncio\.to_thread\(load_model\)/);
  assert.match(source, /torch\.cuda\.empty_cache\(\)/);
  assert.match(source, /@app\.post\("\/admin\/model\/load"\)/);
  assert.match(source, /@app\.post\("\/admin\/model\/unload"\)/);
  assert.match(source, /load_on_demand/);
  assert.match(source, /active_requests/);
  assert.match(source, /generation_lock/);
  assert.match(source, /local_files_only=True/);
  assert.match(source, /MODEL_SEARCH_ROOT/);
  assert.match(source, /rglob\(model_name\)/);
  assert.match(source, /config\.json/);
  assert.match(source, /INFERENCE_AUTH_SECRET_FILE/);
  assert.match(source, /MODEL_SCHEMA_MISMATCH/);
  assert.match(source, /MODEL_IN_USE/);
  assert.match(source, /# Loading is deliberately lazy/);
  assert.match(source, /active_requests == 0 and last_used_at > 0/);
  assert.doesNotMatch(source, /startup\(\)[\s\S]*?load_model\(\)/);
});

test('inference lifecycle timeouts are bounded in Compose', () => {
  const compose = readFileSync(join(process.cwd(), 'compose.yml'), 'utf8');
  assert.match(compose, /MODEL_IDLE_SECONDS/);
  assert.match(compose, /MODEL_LOAD_TIMEOUT_SECONDS/);
  assert.match(compose, /MODEL_UNLOAD_TIMEOUT_SECONDS/);
  assert.match(compose, /start_period: 15s/);
  assert.match(source, /INFERENCE_IDLE_TIMEOUT_INVALID/);
  assert.match(source, /INFERENCE_LOAD_TIMEOUT_INVALID/);
  assert.match(source, /INFERENCE_UNLOAD_TIMEOUT_INVALID/);
});

test('inference is isolated to the backend network and model requests are bounded', () => {
  const compose = readFileSync(join(process.cwd(), 'compose.yml'), 'utf8');
  const health = readFileSync(join(process.cwd(), 'apps', 'web-app', 'app', 'api', 'health', 'route.ts'), 'utf8');
  assert.match(compose, /networks: \[inference, egress\]/);
  assert.match(compose, /networks: \[inference\]/);
  assert.match(compose, /count: 1/);
  assert.match(compose, /INFERENCE_MEMORY_LIMIT/);
  assert.match(compose, /source: \$\{MODEL_SEARCH_ROOT:-D:\/AI-Models\}/);
  assert.match(compose, /target: \/models/);
  assert.match(source, /@app\.get\("\/ready"\)/);
  assert.match(source, /MODEL_LOAD_FAILED/);
  assert.match(source, /message exceeds 32768 bytes/);
  assert.doesNotMatch(health, /worker:3001\/internal\/health/);
  assert.match(health, /authorization/);
});
