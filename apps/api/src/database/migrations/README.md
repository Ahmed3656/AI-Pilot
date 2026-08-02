# Migrations

`../migration-manifest.ts` is the only migration registry. Add every generated
migration class to that manifest in execution order; runtime discovery does not
glob this directory. Keep tests and helpers outside this directory so the CLI
can never import Jest files while loading the data source.

Existing migration names are durable database identities and must not be
renamed after merge. Three foundation migrations intentionally retain their
shared `1784389500000` suffix; their deterministic tie order is recorded in the
manifest.

New autonomous-testing foundation timestamps use PostgreSQL `timestamptz` and
represent UTC instants. The forward UTC reconciliation migration preserves the
legacy shopping `BaseEntity` unchanged while auth and neutral foundations use
`UtcBaseEntity`.

Never enable TypeORM synchronization in shared environments. Validate new
migrations against a disposable PostgreSQL database before handoff.
