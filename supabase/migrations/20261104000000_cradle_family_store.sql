-- Cradle on the web: one shared log per family, no accounts.
-- Lives in the Gainsboard Supabase project (hvpwgqliuykzebjkejyu) in its own `cradle` schema, which the API does not
-- expose. The browser reaches it only through the public.cradle_* functions below, and every one of them needs the
-- family's secret key (the part after ?k= in the family link). Only a SHA-256 hash of the key is stored.
create schema if not exists cradle;
revoke all on schema cradle from public, anon, authenticated;

create table cradle.households (
  id uuid primary key default gen_random_uuid(),
  key_hash bytea not null unique,
  label text not null default '',
  created_at timestamptz not null default now()
);

create sequence cradle.doc_seq;

-- One row per app document ("baby/profile", "events/<id>", "data/users/<person>/prefs" ...). A delete keeps the row
-- as a tombstone (deleted = true, data null) so other phones learn about it on their next pull.
create table cradle.docs (
  household_id uuid not null references cradle.households(id) on delete cascade,
  path text not null check (length(path) <= 300 and path ~ '^[A-Za-z0-9_.:@+~-]+(/[A-Za-z0-9_.:@+~-]+)+$'),
  data jsonb,
  deleted boolean not null default false,
  seq bigint not null default nextval('cradle.doc_seq'),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (household_id, path)
);
create index docs_seq on cradle.docs (household_id, seq);

-- Feedback notes pinned to a spot in the app (like Gainsboard's pins).
create table cradle.pins (
  id bigint generated always as identity primary key,
  household_id uuid not null references cradle.households(id) on delete cascade,
  by_id text, by_name text check (length(by_name) <= 80),
  view text not null default '' check (length(view) <= 300),
  selector text not null check (length(selector) <= 2000),
  element_text text check (length(element_text) <= 200),
  box jsonb, point jsonb, viewport jsonb,
  app_version text check (length(app_version) <= 40), user_agent text check (length(user_agent) <= 400),
  message text not null check (length(message) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_note text check (length(resolved_note) <= 2000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index pins_household on cradle.pins (household_id, created_at);

-- AI calls (reading unclear text, explaining the day), capped per family per day.
create table cradle.ai_calls (
  id bigint generated always as identity primary key,
  household_id uuid not null references cradle.households(id) on delete cascade,
  at timestamptz not null default now()
);
create index ai_calls_household on cradle.ai_calls (household_id, at desc);

alter table cradle.households enable row level security;
alter table cradle.docs enable row level security;
alter table cradle.pins enable row level security;
alter table cradle.ai_calls enable row level security;

create or replace function cradle.household_for(p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare h uuid;
begin
  if p_key is null or length(p_key) < 20 or length(p_key) > 100 then raise exception 'bad family key' using errcode = '28000'; end if;
  select id into h from cradle.households where key_hash = extensions.digest(p_key, 'sha256');
  if h is null then raise exception 'bad family key' using errcode = '28000'; end if;
  return h;
end $$;

-- Everything that changed after `p_since` (a seq number; 0 = everything). Returns {seq, docs:[{path,data,deleted}]}.
-- The returned seq (the phone's next p_since) stops short of rows written in the last 10 seconds, so a save that was
-- still committing when this ran is fetched next time instead of being skipped. Phones get those rows twice; harmless.
create or replace function public.cradle_pull(p_key text, p_since bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h uuid := cradle.household_for(p_key); since bigint := greatest(coalesce(p_since, 0), 0);
begin
  return jsonb_build_object(
    'seq', greatest(since, coalesce((select max(seq) from cradle.docs where household_id = h and updated_at < now() - interval '10 seconds'), 0)),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'data', data, 'deleted', deleted) order by seq)
                      from cradle.docs where household_id = h and seq > since), '[]'::jsonb));
end $$;

-- Saves up to 100 documents at once: [{path, data}] sets, [{path, del: true}] deletes. Returns {rejected: [paths]}.
--   * A set carrying data.updated_at older than the stored copy's is refused (an edit made offline must not overwrite
--     a newer edit from the other phone). Deletes always apply.
--   * {if_absent: true} only creates: it never replaces a live document (a phone that set up the baby while offline
--     must not overwrite the family's real profile).
create or replace function public.cradle_push(p_key text, p_writes jsonb, p_by text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h uuid := cradle.household_for(p_key); w jsonb; p text; del boolean; absent boolean; n int; rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_writes) <> 'array' or jsonb_array_length(p_writes) > 100 then raise exception 'bad writes' using errcode = '22023'; end if;
  for w in select * from jsonb_array_elements(p_writes) loop
    p := w->>'path'; del := coalesce((w->>'del')::boolean, false); absent := coalesce((w->>'if_absent')::boolean, false);
    if p is null or length(p) > 300 or p !~ '^[A-Za-z0-9_.:@+~-]+(/[A-Za-z0-9_.:@+~-]+)+$' or p ~ '(^|/)[.]+(/|$)' then raise exception 'bad path %', left(coalesce(p, ''), 60) using errcode = '22023'; end if;
    if not del and (jsonb_typeof(w->'data') <> 'object' or length((w->'data')::text) > 65536) then raise exception 'bad data for %', p using errcode = '22023'; end if;
    insert into cradle.docs as d (household_id, path, data, deleted, updated_by)
      values (h, p, case when del then null else w->'data' end, del, left(p_by, 80))
      on conflict (household_id, path) do update set data = excluded.data, deleted = excluded.deleted,
        seq = nextval('cradle.doc_seq'), updated_at = now(), updated_by = excluded.updated_by
      where (not absent or d.deleted)
        and (excluded.deleted or d.deleted
             or jsonb_typeof(d.data->'updated_at') is distinct from 'number' or jsonb_typeof(excluded.data->'updated_at') is distinct from 'number'
             or (excluded.data->>'updated_at')::numeric >= (d.data->>'updated_at')::numeric);
    get diagnostics n = row_count;
    if n = 0 then rejected := rejected || to_jsonb(p); end if;
  end loop;
  return jsonb_build_object('rejected', rejected);
end $$;

create or replace function public.cradle_pins(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'household_id' order by p.created_at), '[]'::jsonb)
  from cradle.pins p where p.household_id = cradle.household_for(p_key) $$;

create or replace function public.cradle_pin_add(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h uuid := cradle.household_for(p_key); r cradle.pins;
begin
  if (select count(*) from cradle.pins where household_id = h and created_at > now() - interval '1 day') >= 200 then
    raise exception 'too many notes today' using errcode = '54000'; end if;
  insert into cradle.pins (household_id, by_id, by_name, view, selector, element_text, box, point, viewport, app_version, user_agent, message)
  values (h, left(p->>'by_id', 80), left(p->>'by_name', 80), left(coalesce(p->>'view', ''), 300), left(p->>'selector', 2000),
          left(p->>'element_text', 200), p->'box', p->'point', p->'viewport', left(p->>'app_version', 40), left(p->>'user_agent', 400), p->>'message')
  returning * into r;
  return to_jsonb(r) - 'household_id';
end $$;

create or replace function public.cradle_pin_delete(p_key text, p_id bigint, p_by text default null) returns void
language sql security definer set search_path = '' as $$
  delete from cradle.pins where id = p_id and household_id = cradle.household_for(p_key) and status = 'open'
    and by_id is not distinct from p_by $$;

-- For the cradle-ai edge function (service role only): checks the key and the daily cap, logs the call.
create or replace function public.cradle_ai_ok(p_key text, p_cap int default 60) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h uuid := cradle.household_for(p_key);
begin
  if (select count(*) from cradle.ai_calls where household_id = h and at > now() - interval '1 day') >= p_cap then return false; end if;
  insert into cradle.ai_calls (household_id) values (h);
  return true;
end $$;

-- Admin view of every family's notes (SQL editor / service role only).
create view cradle.admin_pins as
  select p.id, p.status, p.created_at, h.label as family, p.by_name, p.view, p.element_text, p.message, p.resolved_note, p.app_version
  from cradle.pins p join cradle.households h on h.id = p.household_id
  order by (p.status = 'open') desc, p.created_at desc;

revoke all on all functions in schema cradle from public, anon, authenticated;
revoke all on function public.cradle_pull(text, bigint), public.cradle_push(text, jsonb, text), public.cradle_pins(text),
  public.cradle_pin_add(text, jsonb), public.cradle_pin_delete(text, bigint, text), public.cradle_ai_ok(text, int) from public;
grant execute on function public.cradle_pull(text, bigint), public.cradle_push(text, jsonb, text), public.cradle_pins(text),
  public.cradle_pin_add(text, jsonb), public.cradle_pin_delete(text, bigint, text) to anon, authenticated;
revoke all on function public.cradle_ai_ok(text, int) from anon, authenticated;
grant execute on function public.cradle_ai_ok(text, int) to service_role;
