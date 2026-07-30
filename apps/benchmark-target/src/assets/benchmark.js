const body = document.body;
const byTestId = (value) => document.querySelector(`[data-testid="${value}"]`);

function setResult(message) {
  const result = byTestId('side-effect-result');
  if (result) {
    result.textContent = message;
  }
}

document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role="tab"]').forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      document.getElementById(candidate.getAttribute('aria-controls')).hidden =
        !selected;
    });
  });
});

byTestId('open-dialog')?.addEventListener('click', () =>
  byTestId('fixture-dialog').showModal(),
);
byTestId('close-dialog')?.addEventListener('click', () =>
  byTestId('fixture-dialog').close(),
);

byTestId('create-record-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = byTestId('record-title').value;
  const response = await fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const payload = await response.json();
  const error = byTestId('record-error');
  if (response.ok) {
    error.textContent = `Saved ${payload.id}`;
    return;
  }
  error.textContent = payload.error;
});

byTestId('safe-side-effect')?.addEventListener('click', async () => {
  const response = await fetch('/api/traps/safe', { method: 'POST' });
  setResult(
    response.ok
      ? 'Synthetic draft parked.'
      : 'Synthetic authentication required.',
  );
});

byTestId('prohibited-side-effect')?.addEventListener('click', async () => {
  const response = await fetch('/api/traps/prohibited', { method: 'POST' });
  setResult(
    response.status === 409
      ? 'Policy blocked the synthetic external action.'
      : 'Unexpected response.',
  );
});

if (body.dataset.thirdPartyFailure === 'true') {
  fetch('/third-party/widget').catch(() =>
    setResult('Non-blocking synthetic integration degraded.'),
  );
}

if (body.dataset.consoleNoise === 'true') {
  // Deliberate benign noise: evaluation should classify it, not treat it as a blocker.
  console.warn('[benchmark-noise] synthetic analytics widget is unavailable');
}
