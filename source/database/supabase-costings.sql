-- Private server API. Browser roles cannot read any kitchen or revision directly.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wood_costings (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  workspace_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL,
  summary jsonb NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (owner, workspace_id)
);
CREATE INDEX IF NOT EXISTS wood_costings_owner_updated ON public.wood_costings(owner, updated_at DESC);
CREATE TABLE IF NOT EXISTS public.wood_costing_versions (
  costing_id uuid NOT NULL REFERENCES public.wood_costings(id) ON DELETE CASCADE,
  version integer NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (costing_id, version)
);
CREATE TABLE IF NOT EXISTS public.wood_accessories (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.wood_accessory_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accessory_id text NOT NULL REFERENCES public.wood_accessories(id),
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS wood_accessory_history ON public.wood_accessory_versions(accessory_id, id DESC);
ALTER TABLE public.wood_costings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wood_costing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wood_accessories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wood_accessory_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wood_costings, public.wood_costing_versions, public.wood_accessories, public.wood_accessory_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wood_costings, public.wood_costing_versions, public.wood_accessories, public.wood_accessory_versions TO service_role;
GRANT USAGE ON SEQUENCE public.wood_accessory_versions_id_seq TO service_role;

-- One atomic operation, with optimistic concurrency checks before any changes.
-- actor_name/admin are supplied only by the authenticated Next.js server, never by a browser.
CREATE OR REPLACE FUNCTION public.wood_commit_costings(actor_name text, actor_admin boolean, checks jsonb, changes jsonb, accessories jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c jsonb; s jsonb; old public.wood_costings%ROWTYPE; a jsonb; ver integer;
BEGIN
  IF actor_name IS NULL OR actor_name = '' OR jsonb_array_length(changes) > 100 THEN RAISE EXCEPTION 'Invalid transaction' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(773815462::bigint);
  FOR c IN SELECT value FROM pg_catalog.jsonb_array_elements(checks) LOOP
    SELECT * INTO old FROM public.wood_costings WHERE id = (c->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR (NOT actor_admin AND old.owner <> actor_name) THEN RAISE EXCEPTION 'Costing not found' USING ERRCODE = 'P0002'; END IF;
    IF old.version <> (c->>'version')::integer THEN RAISE EXCEPTION 'Costing changed; reopen its latest version' USING ERRCODE = '40001'; END IF;
  END LOOP;
  FOR c IN SELECT value FROM pg_catalog.jsonb_array_elements(changes) LOOP
    s := c->'saved';
    SELECT * INTO old FROM public.wood_costings WHERE id = (s->>'id')::uuid FOR UPDATE;
    IF FOUND THEN
      IF (NOT actor_admin AND old.owner <> actor_name) OR old.owner <> s->>'owner' OR old.workspace_id <> s->'entry'->>'id' THEN RAISE EXCEPTION 'Invalid owner' USING ERRCODE = '42501'; END IF;
      IF old.version <> (c->>'expectedVersion')::integer OR (c->>'expectedVersion') IS NULL OR (s->>'version')::integer <> old.version + 1 THEN RAISE EXCEPTION 'Costing changed; reopen its latest version' USING ERRCODE = '40001'; END IF;
    ELSE
      IF c->>'expectedVersion' IS NOT NULL OR (s->>'version')::integer <> 1 OR (NOT actor_admin AND s->>'owner' <> actor_name) THEN RAISE EXCEPTION 'Invalid new costing' USING ERRCODE = '40001'; END IF;
    END IF;
    INSERT INTO public.wood_costings(id, owner, workspace_id, version, deleted_at, updated_at, summary, payload)
      VALUES ((s->>'id')::uuid, s->>'owner', s->'entry'->>'id', (s->>'version')::integer, (s->>'deletedAt')::timestamptz, (s->>'updatedAt')::timestamptz, s - 'entry', s)
      ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version, deleted_at=EXCLUDED.deleted_at, updated_at=EXCLUDED.updated_at, summary=EXCLUDED.summary, payload=EXCLUDED.payload;
    INSERT INTO public.wood_costing_versions VALUES ((s->>'id')::uuid, (s->>'version')::integer, s);
    DELETE FROM public.wood_costing_versions WHERE costing_id=(s->>'id')::uuid AND version NOT IN
      (SELECT version FROM public.wood_costing_versions WHERE costing_id=(s->>'id')::uuid ORDER BY version DESC LIMIT 5);
  END LOOP;
  FOR a IN SELECT value FROM pg_catalog.jsonb_array_elements(accessories) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.wood_accessories WHERE id=a->>'id' AND payload=a) THEN
      INSERT INTO public.wood_accessories VALUES (a->>'id',a) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload;
      INSERT INTO public.wood_accessory_versions(accessory_id,payload) VALUES(a->>'id',a);
      DELETE FROM public.wood_accessory_versions WHERE accessory_id=a->>'id' AND id NOT IN
        (SELECT id FROM public.wood_accessory_versions WHERE accessory_id=a->>'id' ORDER BY id DESC LIMIT 5);
    END IF;
  END LOOP;
  RETURN '{"ok":true}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.wood_commit_costings(text,boolean,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wood_commit_costings(text,boolean,jsonb,jsonb,jsonb) TO service_role;
COMMIT;
