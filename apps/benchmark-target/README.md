# Local deterministic benchmark target

This is a fully local synthetic web application used to evaluate the autonomous-testing Platform. It does not contact, copy, or model a real customer application. Its seeded behavior is the versioned contract in [`truth-manifest.json`](./truth-manifest.json).

## Start

From the repository root:

```powershell
npm run benchmark:target
```

The target listens on `http://127.0.0.1:4317`. It uses only Node.js built-ins and local `/assets` files. Its CSP permits only same-origin scripts, styles, images, and connections.

## Reset and profiles

The target starts in the deterministic `faulty` profile. Resetting establishes the complete fixed fixture set, including the single record at `/workspace/records/record-0001`.

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:4317/__benchmark/reset -ContentType 'application/json' -Body '{"profile":"faulty"}'
Invoke-RestMethod -Method Post http://127.0.0.1:4317/__benchmark/reset -ContentType 'application/json' -Body '{"profile":"clean"}'
```

To compare one seed, supply `enabledSeeds` as a partial object; all omitted seeds use the chosen profile default.

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:4317/__benchmark/reset -ContentType 'application/json' -Body '{"profile":"clean","enabledSeeds":{"critical-create-save-500":true}}'
```

`GET /health`, `GET /ready`, and `GET /__benchmark/state` expose deterministic target state. `GET /__benchmark/truth-manifest` serves the exact machine-readable benchmark truth.

## Synthetic roles and safe actions

The only roles are anonymous, `contributor`, and `owner`. A local role session needs no password or other credential material:

```powershell
Invoke-WebRequest -Method Post http://127.0.0.1:4317/auth/session -ContentType 'application/json' -Body '{"role":"owner"}'
```

`POST /api/records` and `POST /api/traps/safe` modify only in-memory synthetic state and are reverted by reset. `POST /api/traps/prohibited` always returns `409` and never makes an external call.

## Evaluation use

Later Platform packets should register this only as a local fixture target and mark all results as synthetic. They should reset before each run, read the truth manifest as the evaluation oracle, use a browser for responsive/accessibility/console observation, and record recall, precision, completion, reproduction, failure-source accuracy, duration, cost, and policy-block behavior. This target does not yet integrate or invoke the Platform runner.
