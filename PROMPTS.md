# Prompts and implementation record

## Foundation

Create a modular LedgerLine foundation with Node.js, Express, PostgreSQL, pooled pg access, dotenv, health/readiness routes, validation, tests, and docs.

## Authentication and authorization

Continue existing project without recreating foundation. Add users migration, ACCOUNT_HOLDER registration, bcrypt, JWT, database-backed roles, admin-only auditor creation, secure admin bootstrap, rate limiting, integration tests, and docs.

## Account management

Continue existing project without replacing working authentication. Add idempotent PostgreSQL account migration, UUID IDs, unique generated account numbers, owner-scoped access, admin/auditor reads, admin-only freeze/close, zero initial paise balance, INR, nonnegative constraints, Zod validation, parameterized SQL, and PostgreSQL integration tests. Document Postman use.

## Implementation notes

Public account creation fixes owner from authenticated identity and rejects all supplied fields. Account-holder queries include owner scope; foreign IDs return 404. Future ledger operations must use an active account row lock inside the same transaction as ledger insertion and balance update.

## Deposit/withdrawal implementation

Added idempotent migration 003 for transactions, ledger_entries, and the DEMO_CLEARING synthetic system ledger account. The APIs use integer paise, no external payment provider, per-user idempotency keys, and a request hash to detect payload changes. A deferred database trigger verifies two equal debit/credit entries before a transaction can commit as completed.

## Account transfer implementation

Added migration 005 for transaction destination account references and destination balance snapshots. TRANSFER records use the existing transaction and idempotency tables. Transfers write source debit and destination credit customer ledger rows without DEMO_CLEARING. Both accounts are locked in sorted UUID order and all balance, transaction, and ledger changes commit atomically.

## Audit trail and security hardening

Added migrations 006 and 007 for append-only audit logs, request IDs, indexes, and stricter actor immutability. Successful/failed authentication, registration, account creation/status changes, successful deposits/withdrawals/transfers, and admin auditor creation are audited. Financial events are inserted in the operation's existing PostgreSQL transaction. Added ADMIN/AUDITOR read-only paginated audit API with action, user, and date filters, and a read-only ledger reconciliation report. DB trigger/ACL protection rejects normal UPDATE/DELETE; privileged owner/superuser bypass remains possible and separate runtime/owner credentials are deployment work. Added integration tests for access, safe audit metadata, immutability, rollback, and reconciliation detection.
