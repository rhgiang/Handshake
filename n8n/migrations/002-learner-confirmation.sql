-- Forward-only, repeatable expansion. Apply after schema.sql, lesson.sql and recap.sql.
-- Existing email addresses remain unconfirmed. To disable sends, deactivate workflows;
-- do not roll back by deleting subscription data or granting consent.
BEGIN;
ALTER TABLE handshake.learners
 ADD COLUMN IF NOT EXISTS learner_token text UNIQUE,
 ADD COLUMN IF NOT EXISTS learner_token_created_at timestamptz,
 ADD COLUMN IF NOT EXISTS learner_confirmed_at timestamptz,
 ADD COLUMN IF NOT EXISTS learner_confirmation_pending boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION handshake.subscribe_verified(p jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,handshake AS $$
DECLARE previous handshake.learners; result jsonb; current_time_utc timestamptz;
 learner_address text:=lower(trim(coalesce(p->>'learnerEmail',''))); changed boolean; wants_send boolean:=false;
 new_token text; combined boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(48151623);
 current_time_utc:=clock_timestamp();
 SELECT * INTO previous FROM handshake.learners WHERE learner_id=p->>'learnerId' FOR UPDATE;
 -- Base function still owns validation, request ordering and contact confirmation.
 result:=handshake.subscribe(p);
 IF result->>'ok' IS DISTINCT FROM 'true' OR p->>'action'='unsubscribe' THEN RETURN result; END IF;
 changed:=previous.learner_id IS NULL OR previous.learner_email IS DISTINCT FROM learner_address OR
  (learner_address<>'' AND previous.learner_confirmed_at IS NULL AND
   (previous.learner_token IS NULL OR previous.learner_token_created_at<current_time_utc-interval '24 hours'));
 IF NOT changed AND previous.learner_confirmation_pending THEN
  RAISE EXCEPTION USING ERRCODE='HSC02', MESSAGE='Confirmation acknowledgement pending';
 END IF;
 IF changed AND learner_address<>'' THEN
  combined:=(result->>'send')::boolean AND result->>'email'=learner_address;
  IF NOT combined AND (EXISTS(SELECT 1 FROM handshake.confirmation_reservations WHERE confirmation_reservations.address=learner_address AND reserved_at>current_time_utc-interval '24 hours') OR
   (SELECT count(*) FROM handshake.confirmation_reservations WHERE reserved_at>current_time_utc-interval '1 hour')>=20) THEN
   RAISE EXCEPTION USING ERRCODE='HSC01', MESSAGE='Confirmation budget exhausted';
  END IF;
  IF NOT combined THEN INSERT INTO handshake.confirmation_reservations(address,reserved_at) VALUES(learner_address,current_time_utc); END IF;
  wants_send:=true; new_token:=handshake.token();
 END IF;
 IF changed THEN
  UPDATE handshake.learners SET learner_token=new_token,
   learner_token_created_at=CASE WHEN wants_send THEN current_time_utc END,
   learner_confirmed_at=NULL,learner_confirmation_pending=wants_send
   WHERE learner_id=p->>'learnerId';
 END IF;
 RETURN result || jsonb_build_object('learnerSend',wants_send AND NOT combined,'learnerIncluded',combined,
  'learnerEmail',CASE WHEN wants_send THEN learner_address END,'learnerToken',new_token);
EXCEPTION
 -- The exception block rolls back the base subscription and its contact reservations too.
 WHEN SQLSTATE 'HSC01' THEN RETURN jsonb_build_object('ok',false,'status',429,'send',false,'learnerSend',false);
 WHEN SQLSTATE 'HSC02' THEN RETURN jsonb_build_object('ok',false,'status',503,'send',false,'learnerSend',false);
END $$;

CREATE OR REPLACE FUNCTION handshake.learner_confirm(token text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,handshake AS $$
DECLARE affected integer;
BEGIN
 IF token IS NULL OR token !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('changed',false); END IF;
 PERFORM pg_advisory_xact_lock(48151623);
 UPDATE handshake.learners SET learner_confirmed_at=now(),learner_token=NULL,
  learner_token_created_at=NULL,learner_confirmation_pending=false
 WHERE learner_token=token AND learner_token_created_at>now()-interval '7 days' AND learner_email<>'';
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN jsonb_build_object('changed',affected>0);
END $$;

CREATE OR REPLACE FUNCTION handshake.learner_confirmation_sent(token text) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,handshake AS $$
BEGIN
 UPDATE handshake.learners SET learner_confirmation_pending=false WHERE learner_token=token;
 RETURN jsonb_build_object('ok',true,'status',200);
END $$;

CREATE OR REPLACE FUNCTION handshake.confirmed_recap_claim() RETURNS SETOF jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,handshake AS $$
DECLARE r handshake.learners; delivery handshake.recap_deliveries; new_lease uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(48151623);
 FOR r IN SELECT * FROM handshake.learners WHERE learner_confirmed_at IS NOT NULL AND learner_email<>'' ORDER BY learner_id FOR UPDATE LOOP
  SELECT * INTO delivery FROM handshake.recap_deliveries WHERE learner_id=r.learner_id FOR UPDATE;
  IF delivery.lease_until>now() OR delivery.last_sent_at>now()-interval '7 days' THEN CONTINUE; END IF;
  new_lease:=gen_random_uuid();
  INSERT INTO handshake.recap_deliveries(learner_id,generation,lease,lease_until) VALUES(r.learner_id,r.generation,new_lease,now()+interval '10 minutes')
  ON CONFLICT(learner_id) DO UPDATE SET generation=excluded.generation,lease=excluded.lease,lease_until=excluded.lease_until;
  RETURN NEXT jsonb_build_object('learnerId',r.learner_id,'lease',new_lease);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION handshake.confirmed_recap_recheck(id text, expected_lease uuid) RETURNS jsonb LANGUAGE plpgsql
SET search_path=pg_catalog,handshake AS $$
DECLARE r handshake.learners;
BEGIN
 PERFORM pg_advisory_xact_lock(48151623);
 SELECT l.* INTO r FROM handshake.learners l JOIN handshake.recap_deliveries d USING(learner_id)
 WHERE l.learner_id=id AND d.lease=expected_lease AND d.lease_until>now() AND d.generation=l.generation
 AND l.learner_confirmed_at IS NOT NULL AND l.learner_email<>'' FOR UPDATE OF l,d;
 IF r.learner_id IS NULL THEN RETURN jsonb_build_object('send',false); END IF;
 RETURN jsonb_build_object('send',true,'email',r.learner_email,'unsubscribeToken',r.learner_unsubscribe_token);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA handshake FROM PUBLIC;
COMMIT;
