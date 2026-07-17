import assert from 'node:assert/strict';
import test from 'node:test';
import { redactPhase1LogLine } from './phase1-log-redaction.mjs';

test('redacts runtime secrets, viewer URLs, tokens, addresses, and screenshots', () => {
  const secret = 'runtime-secret-value';
  const line = JSON.stringify({
    authorization: `Bearer ${secret}`,
    viewerUrl: `https://example.test/viewer/?token=${secret}`,
    address: { street: 'Private Street', mobileNumber: '01000000000' },
    screenshot: 'data:image/png;base64,AAAA',
  });

  const redacted = redactPhase1LogLine(line, [secret]);

  assert.equal(redacted.includes(secret), false);
  assert.equal(redacted.includes('Private Street'), false);
  assert.equal(redacted.includes('01000000000'), false);
  assert.equal(redacted.includes('AAAA'), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test('leaves ordinary health log content intact', () => {
  assert.equal(
    redactPhase1LogLine('gateway health status=ok', []),
    'gateway health status=ok',
  );
});
