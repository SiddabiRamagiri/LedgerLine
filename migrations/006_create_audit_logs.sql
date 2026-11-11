CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(128),
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_logs_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS audit_logs_event_timestamp_idx ON audit_logs (event_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_timestamp_idx ON audit_logs (action, event_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_timestamp_idx ON audit_logs (actor_user_id, event_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS audit_logs_request_id_idx ON audit_logs (request_id);

CREATE OR REPLACE FUNCTION audit_logs_reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Preserve the nullable actor FK when an old user is deleted; no event payload changes.
  IF TG_OP = 'UPDATE' AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit records cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM CURRENT_USER;
COMMENT ON TABLE audit_logs IS 'Append-only application audit events; privileged database owners can still bypass protections.';
