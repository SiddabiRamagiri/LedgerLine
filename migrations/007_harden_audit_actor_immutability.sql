CREATE OR REPLACE FUNCTION audit_logs_reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Allow only the nested FK referential action that anonymizes a deleted actor.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
     AND OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit records cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM CURRENT_USER;
