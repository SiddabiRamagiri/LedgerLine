# LedgerLine

LedgerLine is a modular Node.js 22, Express, PostgreSQL API with health checks, migrations, password authentication, JWTs, server-side role authorization, and account management.

## Setup

1. Run npm install.
2. Configure .env using .env.example. Set DATABASE_URL and a private JWT_SECRET of at least 32 bytes. Keep .env private and uncommitted.
3. Create the PostgreSQL database ledgerline_db.
4. Apply schema with npm run db:migrate.
5. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in the process environment, then run npm run bootstrap:admin once. Bootstrap refuses if any admin already exists.
6. Start with npm start. Run tests with npm test. Integration tests use PostgreSQL and clean up generated test records.

## Frontend

The React/Vite client is an independent app under `frontend/`; it uses the existing Express APIs and does not add or change backend endpoints.

1. In the project root, start the backend with `npm start` (default `http://localhost:3000`).
2. In a second terminal, run `npm --prefix frontend install` once.
3. Run `npm run dev --prefix frontend` and open the Vite URL printed in the terminal (normally `http://localhost:5173`). Vite proxies `/api` requests to the backend.
4. For a production build run `npm run build --prefix frontend`; serve the generated `frontend/dist/` directory from a static host. Set `VITE_API_BASE_URL` at build time if the API is hosted on a different origin. The API host must permit the frontend origin when using a direct production API URL.
5. To browser-check all role workflows, start both servers as above and run `npm run smoke:roles --prefix frontend` from the project root. It requires Chrome, PostgreSQL, and the development API, and exercises registration/login plus real synthetic deposit, withdrawal, and transfer endpoints. It deletes its fixture accounts and transactions; append-only audit events remain. Run only against a development database.

The frontend uses `sessionStorage` for the bearer token, clears the session when an API call receives 401, and relies on backend authentication/role checks for authorization. Public sign-up creates only account holders. Admin and auditor credentials must already be provisioned through the backend's existing bootstrap/admin flows. Dashboard totals and tables are fetched from the API; no sample financial balances or simulated successful payments are included. API errors distinguish invalid input, expired sessions, forbidden access, missing resources, conflicts, rate limits, and server/network failures.

Frontend role navigation:

- ACCOUNT_HOLDER: overview, own accounts, deposit/withdraw/transfer, and own transaction history.
- ADMIN: overview, all accounts with freeze/close controls, users with auditor provisioning, audit logs, and reconciliation.
- AUDITOR: read-only overview, all accounts, account transaction history, audit logs, and reconciliation.

Money forms convert rupee text to integer paise, enforce the backend's per-operation limit, and attach a fresh `Idempotency-Key` to each new request. Transfers accept the recipient's account UUID because the backend has no account-number lookup route.

## Authentication APIs

POST /api/auth/register accepts JSON fullName, email, password. Public signups always become ACCOUNT_HOLDER; extra fields such as role are rejected.
POST /api/auth/login accepts email and password. Success returns { token, user }. Send protected tokens as Authorization: Bearer <token>.

## Account APIs

All account endpoints require a valid bearer token.

POST /api/accounts creates an account for the authenticated ACCOUNT_HOLDER. Send an empty JSON object or no body. The server generates a unique LL plus 14-digit account number, assigns owner_user_id from authenticated identity, and sets balance to 0 paise, currency INR, and status ACTIVE. Supplied owner, balance, currency, status, or other fields are rejected. Returns 201.

GET /api/accounts returns only the caller's accounts to ACCOUNT_HOLDER users. ADMIN and AUDITOR receive all accounts.

GET /api/accounts/:id returns one account. ACCOUNT_HOLDER access is owner-scoped; a foreign account returns 404. ADMIN and AUDITOR can read any account.

PATCH /api/accounts/:id/status accepts only {"status":"FROZEN"} or {"status":"CLOSED"} and requires ADMIN. Closed accounts are terminal. Account holders and auditors receive 403.

Balances are returned as balancePaise, a decimal string representing integer paise. The database enforces nonnegative values and INR currency.

## Postman examples

1. POST /api/auth/register with raw JSON {"fullName":"Ada Example","email":"ada@example.com","password":"a-long-password-123"}, then POST /api/auth/login with the same credentials.
2. Copy the token from login. For account requests choose Authorization > Bearer Token in Postman.
3. POST http://localhost:3000/api/accounts with Body > raw > JSON {}. Expect 201 and balancePaise "0".
4. GET http://localhost:3000/api/accounts to list visible accounts. GET /api/accounts/{id} for details.
5. As ADMIN, PATCH /api/accounts/{id}/status with {"status":"FROZEN"} or {"status":"CLOSED"}.
6. Use a second ACCOUNT_HOLDER token against the first holder's account ID; expect 404. Send balance_paise or owner_user_id on creation; expect 400.

The first ADMIN is created only by the one-time bootstrap. AUDITOR users can read all accounts but cannot change status.

## Financial integrity

Deposits, withdrawals, and transfers use integer paise, idempotency keys, row locks, and PostgreSQL transactions. The account projection, completed transaction, matching ledger entries, and financial audit event commit together. Database deferred constraints protect balanced entries and account projections. Reconciliation reports discrepancies without repairing data.

## Main files

`src/app.js` assembles routes and request IDs. `src/routes/` contains auth, admin/audit, account, transaction, and transfer APIs. `src/db/` provides parameterized SQL and audit queries. `src/services/` owns atomic financial operations and read-only reconciliation. `migrations/` contains additive schema migrations. `scripts/migrate.js` applies migrations. `test/` contains PostgreSQL integration tests for existing and audit/financial behavior.

## Deposits, withdrawals, and transaction history

These operations use synthetic demonstration funds only; they do not call a bank or payment provider. A valid bearer token and ACCOUNT_HOLDER role are required for deposits and withdrawals. Every request also requires an Idempotency-Key header containing 8-255 visible ASCII characters.

POST /api/accounts/:id/deposits and POST /api/accounts/:id/withdrawals accept strict JSON {"amount_paise":12500}. Amount must be an integer from 1 through 100000000 paise (₹1,000,000 per operation). Deposits debit the DEMO_CLEARING synthetic ledger account and credit the customer account. Withdrawals debit the customer account and credit DEMO_CLEARING. The first successful request returns 201. An identical retry returns 200 with the original transaction; the same key with different account, type, or amount returns 409. Insufficient funds and frozen/closed accounts return 409.

GET /api/accounts/:id/transactions?page=1&limit=20 returns completed transactions newest-first. Page defaults to 1; limit defaults to 20 and is capped at 100. Account holders can read their own history; ADMIN and AUDITOR can read all account history.

Postman: log in, choose Authorization > Bearer Token, then POST a deposit or withdrawal with raw JSON and a unique Idempotency-Key header such as a UUID. Retry with the identical header and body to verify replay; alter the amount with the same key to verify HTTP 409. GET the transaction history URL to test pagination.

Amounts are stored as BIGINT paise. The account row lock, cached balance update, transaction record, and equal debit/credit ledger entries commit together in one PostgreSQL transaction. A deferred database constraint trigger rejects completed transactions without exactly two balanced entries. Future ledger operations must use the active-account row-lock helper. No external payments are integrated.

Migration 004 adds deferred database checks that completed ledger entry amounts equal the transaction amount and that an account balance projection always matches the net customer ledger entries.

## Account-to-account transfers

POST /api/accounts/:id/transfers requires an ACCOUNT_HOLDER bearer token and Idempotency-Key. The source account in the URL must belong to the caller. The destination account can belong to another user. Both accounts must exist, be ACTIVE, and use INR; source and destination must differ. Amount is a positive integer from 1 through 100000000 paise.

Raw JSON body:

    {"destination_account_id":"<destination UUID>","amount_paise":20000}

The transfer returns 201 on first completion. Replaying the same key and payload returns 200 with the original result; a changed source, destination, or amount with that key returns 409. Insufficient funds or inactive accounts return 409. Unknown or unauthorized source accounts return 404.

Each transfer locks both UUIDs in sorted order, then checks ownership/status and updates both balances, one transaction row, and two ledger entries in one PostgreSQL transaction. Ledger entries are a source DEBIT and destination CREDIT of the same amount; no system clearing account is involved. Deferred database constraints verify the entry sides, accounts, amounts, and cached balance projections before commit. Transfers conserve total customer balances.

Postman: log in, set Authorization > Bearer Token, add Idempotency-Key with a unique UUID, then POST the example body to the source account URL. Retry unchanged to test replay; change the destination or amount using the same key to test HTTP 409. GET /api/accounts/:id/transactions to see sent and received transfers.

## Audit trail and reconciliation

Migration 006 creates `audit_logs` with nullable `actor_user_id` referencing users, action, entity type/id, server request UUID, timestamp, and non-secret JSON metadata. Migration 007 hardens actor immutability while allowing the nested FK action to null an actor when a user is deleted. Successful registration/login, failed login, account creation/status changes, deposits, withdrawals, transfers, and auditor creation write events. Financial events are inserted through the same PostgreSQL client/transaction as the money movement, so audit failure rolls back the operation. Authentication/admin/account changes also insert the associated audit event in their database transaction. Failed login metadata records only a generic reason; it does not store the submitted email, password, bearer token, JWT, or database credentials.

The API returns a generated `X-Request-Id` response header; a valid UUID supplied as `X-Request-Id` is retained for tracing. `GET /api/admin/audit-logs?page=1&limit=20&action=TRANSFER_COMPLETED&user_id=123&from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z` is available to ADMIN and AUDITOR only. Dates are inclusive at `from` and exclusive at `to`; ordering is newest first. Account holders get 403. Postman: authenticate as ADMIN/AUDITOR, send GET with optional query params, and use the returned pagination object. It has no write endpoint.

`GET /api/admin/reconciliation` is ADMIN/AUDITOR-only and read-only. It reports completed transaction debit/credit and entry shape discrepancies, account cached-balance versus ledger-projection mismatches, and negative balances; it never repairs records. Use it from Postman with a bearer token.

Audit protection uses BEFORE UPDATE/DELETE triggers and revokes UPDATE, DELETE, and TRUNCATE from PUBLIC and the migration's current database role. A user deletion can only null the actor foreign key while preserving all other event columns; this retains audit rows while allowing the user FK action. This is tamper resistance, not absolute immutability: a PostgreSQL superuser/database owner can alter/drop triggers, change grants, restore backups, or directly manipulate the schema. The current application and migration setup may use the same DATABASE_URL role; production should use a separate non-owner runtime login granted only required SELECT/INSERT on audit_logs and a separately controlled migration/owner login. That split is not provisioned automatically by this project, because role creation and credential deployment are environment-specific. Restrict database administration, backups, and migration access accordingly.

Integration tests run against PostgreSQL. The reconciliation corruption test temporarily disables user triggers inside a transaction and rolls it back; it does not leave altered financial data behind.
