-- Run as the separately controlled migration/database owner after migrations.
-- Create ledgerline_runtime with a secret-managed password in Neon first.
GRANT CONNECT ON DATABASE ledgerline_db TO ledgerline_runtime;
GRANT USAGE ON SCHEMA public TO ledgerline_runtime;
REVOKE CREATE ON SCHEMA public FROM ledgerline_runtime;

REVOKE ALL ON TABLE users, accounts, system_ledger_accounts, transactions, ledger_entries, audit_logs FROM PUBLIC;
REVOKE ALL ON TABLE users, accounts, system_ledger_accounts, transactions, ledger_entries, audit_logs FROM ledgerline_runtime;

GRANT SELECT, INSERT ON TABLE users TO ledgerline_runtime;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO ledgerline_runtime;

GRANT SELECT, INSERT ON TABLE accounts TO ledgerline_runtime;
GRANT UPDATE (balance_paise, status, updated_at) ON TABLE accounts TO ledgerline_runtime;

GRANT SELECT ON TABLE system_ledger_accounts TO ledgerline_runtime;

GRANT SELECT, INSERT ON TABLE transactions TO ledgerline_runtime;
GRANT UPDATE (status, balance_after_paise, destination_balance_after_paise) ON TABLE transactions TO ledgerline_runtime;

GRANT SELECT, INSERT ON TABLE ledger_entries TO ledgerline_runtime;
GRANT SELECT, INSERT ON TABLE audit_logs TO ledgerline_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM PUBLIC, ledgerline_runtime;
