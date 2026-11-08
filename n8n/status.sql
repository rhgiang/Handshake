-- Read-only notification status for the Settings page. Forward-only and idempotent: apply after schema.sql, same dedicated database and role.
-- Returns enum strings and booleans only: never emails, names or tokens.
BEGIN;
CREATE OR REPLACE FUNCTION handshake.notification_status(p_learner text) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path = pg_catalog, handshake AS $$
DECLARE r handshake.learners%ROWTYPE; contact text; awaiting boolean;
BEGIN
 IF p_learner IS NULL OR length(p_learner) NOT BETWEEN 1 AND 100 THEN
  RETURN jsonb_build_object('contact','none','recap','none','expired',false,'delivery','ok');
 END IF;
 SELECT * INTO r FROM handshake.learners WHERE learner_id = p_learner;
 IF NOT FOUND THEN
  IF EXISTS (SELECT 1 FROM handshake.revoked_learners WHERE learner_id = p_learner) THEN
   RETURN jsonb_build_object('contact','stopped','recap','stopped','expired',false,'delivery','ok');
  END IF;
  RETURN jsonb_build_object('contact','none','recap','none','expired',false,'delivery','ok');
 END IF;
 awaiting := r.contact_email <> '' AND r.contact_confirmed_at IS NULL;
 contact := CASE WHEN r.contact_confirmed_at IS NOT NULL THEN 'confirmed' WHEN awaiting THEN 'awaiting_confirmation' ELSE 'none' END;
 RETURN jsonb_build_object(
  'contact', contact,
  'recap', CASE WHEN r.learner_email <> '' THEN 'requested' ELSE 'none' END,
  'expired', awaiting AND r.contact_token_created_at IS NOT NULL AND r.contact_token_created_at < now() - interval '7 days',
  'delivery', CASE WHEN awaiting AND r.confirmation_delivery_pending THEN 'pending' ELSE 'ok' END);
END $$;
REVOKE ALL ON FUNCTION handshake.notification_status(text) FROM PUBLIC;
COMMIT;
