import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPublicAddress, validateEgressUrl, validateResolvedEgressUrl } from '../packages/domain/src/egress.ts';
test('egress rejects private, loopback, mapped, and unsupported destinations', () => {
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.1.2', '192.168.1.1', '::1', 'fd00::1', '::ffff:192.168.1.2']) assert.equal(isPublicAddress(address), false);
  assert.deepEqual(validateEgressUrl('http://127.0.0.1/', ['http://127.0.0.1']), { allowed: false, code: 'PRIVATE_ADDRESS' });
  const file = validateEgressUrl('file:///tmp/a', ['file:///tmp']); assert.equal('code' in file ? file.code : '', 'UNSUPPORTED_PROTOCOL');
});
test('egress allows only approved public HTTP origins', () => {
  assert.deepEqual(validateEgressUrl('https://jobs.example.test/search', ['https://jobs.example.test']), { allowed: true, hostname: 'jobs.example.test', port: 443 });
  assert.equal(validateEgressUrl('https://other.example.test/', ['https://jobs.example.test']).allowed, false);
});
test('resolved egress rejects DNS rebinding to a private address', async () => {
  const result = await validateResolvedEgressUrl('https://jobs.example.test/search', ['https://jobs.example.test'], async () => ['93.184.216.34', '10.0.0.1']);
  assert.deepEqual(result, { allowed: false, code: 'DNS_PRIVATE_ADDRESS' });
  assert.equal((await validateResolvedEgressUrl('https://jobs.example.test/search', ['https://jobs.example.test'], async () => ['93.184.216.34'])).allowed, true);
});
