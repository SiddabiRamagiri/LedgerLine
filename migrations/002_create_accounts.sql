CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number VARCHAR(16) NOT NULL CONSTRAINT accounts_account_number_key UNIQUE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  balance_paise BIGINT NOT NULL DEFAULT 0 CONSTRAINT accounts_balance_nonnegative CHECK (balance_paise >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CONSTRAINT accounts_currency_inr CHECK (currency = 'INR'),
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CONSTRAINT accounts_status_valid CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounts_number_format CHECK (account_number ~ '^LL[0-9]{14}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_account_number_key ON accounts (account_number);
CREATE INDEX IF NOT EXISTS accounts_owner_created_idx ON accounts (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts (status);
CREATE OR REPLACE FUNCTION accounts_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS accounts_touch_updated_at_trigger ON accounts;
CREATE TRIGGER accounts_touch_updated_at_trigger
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION accounts_touch_updated_at();
COMMENT ON TABLE accounts IS 'Balances are integer paise; future ledger writes must lock and update atomically.';
