# Threats and mitigations

| Threat | Mitigation | Remaining consideration |
| --- | --- | --- |
| Database/JWT credentials leak | Secrets remain in ignored .env or protected environment settings; logs omit secrets. | Protect deployment secret storage and rotate exposed values. |
| SQL injection | Account/user query values use PostgreSQL placeholders. | Allowlist future dynamic identifiers. |
| Password theft | bcrypt hashes are never returned. | Use TLS and add account recovery. |
| Role escalation | Existing auth reloads role from PostgreSQL; account routes reuse authenticate and requireRole. | Restrict DB write access. |
| Ownership spoofing | Creation derives owner_user_id from identity; strict Zod schema rejects extra fields. | Keep owner filtering on future subresources. |
| IDOR | Holder queries scope both account id and owner id; foreign ids return 404. | Test every new account subresource. |
| Negative/fractional balances | BIGINT paise, database CHECK balance_paise >= 0, creation always zero. | Make ledger writes atomic under concurrency. |
| Account number collision | Cryptographic number generation, unique DB constraint, bounded collision retry. | Monitor retry exhaustion. |
| Unauthorized status changes | PATCH uses ADMIN role; only FROZEN/CLOSED accepted; CLOSED is terminal. | Reopening requires an explicit audited workflow if ever added. |
| Frozen/closed transaction | Future ledger helper SELECTs only ACTIVE rows FOR UPDATE and rejects other statuses. | No ledger transaction APIs exist; future writes must use this helper inside their transaction. |
| Error disclosure | Generic server errors; logs include method/status/code, not raw error text or credentials. | Protect log access. |
| Invalid input | Strict Zod schemas, JSON size limit, SQL constraints. | Add endpoint-specific limits to future APIs. |

Account integration tests use PostgreSQL and clean their fixtures. The row-lock helper prepares future atomic transactions; it does not add deposit/withdrawal endpoints.

| Threat | Mitigation | Remaining consideration |
| --- | --- | --- |
| Duplicate or concurrent request moves funds twice | Per-user idempotency uniqueness, request fingerprint, row lock, replay lookup, and uniqueness-race recovery. | Clients must reuse a key only with the identical payload. |
| Concurrent withdrawals overspend | Account SELECT FOR UPDATE, BigInt arithmetic, and database nonnegative constraint. | Keep future balance mutations inside the same transaction service. |
| Partial ledger or projection update | Account projection, transaction row, and ledger entries commit in one DB transaction; deferred trigger requires exactly one customer and system entry with equal totals. | Reconcile cached balances against ledger totals operationally. |
| Frozen or closed account accepts a transaction | Shared active-account locking helper is required before a balance mutation. | No real payment rails or external payment provider are integrated. |
| Excessive or fractional money input | Strict positive-integer paise schema and fixed per-operation cap. | Change the API and DB limit together if policy changes. |

Integration tests use PostgreSQL and include an induced ledger insertion error to verify transaction rollback. Operations add synthetic demonstration funds only.

| Threat | Mitigation | Remaining consideration |
| --- | --- | --- |
| Transfer from another user's account | The source account is locked and owner-checked against the authenticated database user; unauthorized source is indistinguishable from missing (404). | Destination ownership is intentionally not required for a transfer. |
| Transfer to frozen/closed or non-INR destination | Both accounts are locked and their status/currency checked before any writes. | Currency is currently constrained to INR for all accounts. |
| Transfer deadlock | Both account UUIDs are locked sequentially in deterministic sorted order. | Preserve this ordering for any future multi-account operation. |
| Transfer loses or creates value | Source debit and destination credit use the same BIGINT paise amount; balances and ledger entries commit together, and deferred triggers validate both account projections. | Continue reconciliation as an operational control. |

Transfer integration tests include opposite-direction concurrent transfers, competing source debits, cross-owner destinations, and rollback after a forced ledger failure.

| Threat | Mitigation | Remaining consideration |
| --- | --- | --- |
| Important financial or administrator event omitted | Registration/login, account lifecycle, money movement, and auditor creation write structured events; financial audit inserts share the financial DB transaction. | Review all future mutating routes and add event coverage alongside them. |
| Sensitive credentials copied into audit data | Metadata is allowlisted by each event call; login failures store only a generic reason, and request body/auth headers are not audited. | Keep future metadata free of secrets and unnecessary personal data. |
| Audit row changed by ordinary SQL | UPDATE/DELETE triggers reject row changes; ACL revokes UPDATE/DELETE/TRUNCATE from PUBLIC and migration runtime role. | Database owner/superuser can change triggers, grants, schema, and backups; this is not absolute immutability. |
| Runtime compromise gains schema-owner authority | Recommended separate migration owner and restricted runtime login. | Current DATABASE_URL may use the migration/current role; role split and secret deployment must be configured per environment. |
| Actor deletion removes history | Actor FK uses ON DELETE SET NULL; event remains and trigger allows only that FK nulling with every other field unchanged. | Actor identity cannot then be resolved from the audit row; retain user lifecycle records if required by policy. |
| Audit read endpoint leaks to holders or allows edits | ADMIN/AUDITOR middleware, strict query validation, GET-only endpoint, parameterized filters, newest-first pagination. | Protect auditor credentials and database read access. |
| Ledger mismatch goes unnoticed | Read-only reconciliation checks completed entry sides/totals, account ledger projections, transfer shape, and negative balances. | It detects and reports; staff must investigate and corrections need a separately controlled process. |

Audit/reconciliation integration tests use PostgreSQL. The reconciliation discrepancy fixture changes a projection only inside a transaction with its integrity trigger disabled, then rolls back. Privileged database administrators can still modify audit history; use external append-only/WORM exports if stronger evidence retention is required.

## Production deployment

| Threat | Mitigation | Remaining consideration |
| --- | --- | --- |
| Migration owner credential stolen from web process | Render runtime receives only pooled `DATABASE_URL`; migration runner requires a distinct direct URL and database role. | Manual migration jobs still need tightly controlled secret injection and owner access. |
| Runtime compromise alters schema or erases audit/ledger rows | `scripts/grant-runtime-privileges.sql` grants limited route DML, selected-column updates, no deletes, and no DDL; audit is read/insert only. | Database owner/superuser and inherited grants can bypass these controls; review effective Neon grants after schema changes. |
| Production web process starts with weak/missing settings | Startup requires a >=32-byte JWT secret, PostgreSQL URL, Neon pooler host and TLS, and production DB TLS. | Secrets and Neon settings must be configured correctly in Render; this repo has no live service credentials. |
| Client IP rate limit bypass/misread behind Render proxy | Production trusts exactly one Express proxy hop. | Reassess proxy topology if another proxy/CDN is added. |
| SPA routes shadow API 404s or stale entry point is cached | SPA fallback excludes `/api`; HTML is revalidated while fingerprinted assets are immutable. | Check cache behavior after frontend asset strategy changes. |
| Bootstrap admin variables persist after setup | Bootstrap is an explicit one-time command and refuses if an admin exists; docs require private short-lived env injection then removal. | Operator must remove secrets and restrict deployment logs/access. |
| Migration unexpectedly mutates production | Render migration pre-deploy command stays disabled; production migration URL is not listed as a web-service secret. | No production migration or deployment has been run; approval, backup plan, and live URL verification remain operational blockers. |

Never run the database-writing integration suite or role-dashboard smoke workflow against Neon production. Tests use fixtures and can create users, accounts, transactions, and permanent append-only audit rows.
