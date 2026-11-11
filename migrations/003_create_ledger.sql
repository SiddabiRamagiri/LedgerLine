CREATE TABLE IF NOT EXISTS system_ledger_accounts (
  id UUID PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO system_ledger_accounts (id, code, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'DEMO_CLEARING', 'Synthetic demonstration funds')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(48) NOT NULL CONSTRAINT transactions_reference_key UNIQUE,
  transaction_type VARCHAR(12) NOT NULL CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise BETWEEN 1 AND 100000000),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  initiated_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  balance_after_paise BIGINT CHECK (balance_after_paise IS NULL OR balance_after_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transactions_user_idempotency_key_key UNIQUE (initiated_by, idempotency_key),
  CONSTRAINT transactions_completed_balance_check CHECK (status <> 'COMPLETED' OR balance_after_paise IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS transactions_account_created_idx ON transactions (account_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_initiated_by_idx ON transactions (initiated_by, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  system_ledger_account_id UUID REFERENCES system_ledger_accounts(id) ON DELETE RESTRICT,
  entry_side VARCHAR(6) NOT NULL CHECK (entry_side IN ('DEBIT', 'CREDIT')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise BETWEEN 1 AND 100000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_entries_one_account_check CHECK ((account_id IS NOT NULL) <> (system_ledger_account_id IS NOT NULL)),
  CONSTRAINT ledger_entries_transaction_side_key UNIQUE (transaction_id, entry_side)
);
CREATE INDEX IF NOT EXISTS ledger_entries_account_created_idx ON ledger_entries (account_id, created_at DESC);

CREATE OR REPLACE FUNCTION ledger_assert_transaction_balanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entry_count INTEGER;
  debit_total NUMERIC;
  credit_total NUMERIC;
  customer_count INTEGER;
  system_count INTEGER;
  expected_customer_count INTEGER;
  expected_system_count INTEGER;
BEGIN
  IF NEW.status = 'COMPLETED' THEN
    SELECT COUNT(*),
      COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'DEBIT'), 0),
      COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'CREDIT'), 0),
      COUNT(*) FILTER (WHERE account_id = NEW.account_id),
      COUNT(*) FILTER (WHERE system_ledger_account_id IS NOT NULL),
      COUNT(*) FILTER (WHERE account_id = NEW.account_id AND entry_side =
        CASE WHEN NEW.transaction_type = 'DEPOSIT' THEN 'CREDIT' ELSE 'DEBIT' END),
      COUNT(*) FILTER (WHERE system_ledger_account_id IS NOT NULL AND entry_side =
        CASE WHEN NEW.transaction_type = 'DEPOSIT' THEN 'DEBIT' ELSE 'CREDIT' END)
    INTO entry_count, debit_total, credit_total, customer_count, system_count,
         expected_customer_count, expected_system_count
    FROM ledger_entries WHERE transaction_id = NEW.id;
    IF entry_count <> 2 OR debit_total <= 0 OR debit_total <> credit_total
       OR customer_count <> 1 OR system_count <> 1
       OR expected_customer_count <> 1 OR expected_system_count <> 1 THEN
      RAISE EXCEPTION 'Completed transaction is not balanced' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS transactions_balanced_trigger ON transactions;
CREATE CONSTRAINT TRIGGER transactions_balanced_trigger
AFTER INSERT OR UPDATE ON transactions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_assert_transaction_balanced();
COMMENT ON TABLE transactions IS 'Synthetic-funds operations; idempotency is unique per initiating user.';
COMMENT ON TABLE ledger_entries IS 'Every completed transaction has equal debit and credit entries.';
