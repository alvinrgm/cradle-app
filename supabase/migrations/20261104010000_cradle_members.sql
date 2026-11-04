-- Cradle families with people in them (like Gainsboard's invites, without accounts).
-- Each parent's phone holds its own personal key (the ?k= in their link). A parent invites someone from the app: the
-- server makes a one-time invite link (7 days); opening it makes the new person their own key. Either parent can remove
-- a lost phone, which kills only that key. Every save is stamped with who made it, by the server.
-- The family's original key (cradle.households.key_hash) still works, as the setup key: it can join no one and is
-- never shown in the app. Only SHA-256 hashes of keys and invite codes are stored.

create table cradle.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references cradle.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  color text check (length(color) <= 20),
  key_hash bytea not null unique,
  invited_by uuid references cradle.members(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen timestamptz,
  removed_at timestamptz,
  removed_by uuid references cradle.members(id) on delete set null
);
create index members_household on cradle.members (household_id) where removed_at is null;

create table cradle.invites (
  code_hash bytea primary key,
  household_id uuid not null references cradle.households(id) on delete cascade,
  created_by uuid references cradle.members(id) on delete set null,
  for_name text check (length(for_name) <= 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references cradle.members(id) on delete set null
);
create index invites_household on cradle.invites (household_id, created_at desc);

alter table cradle.members enable row level security;
alter table cradle.invites enable row level security;

-- Who a key belongs to: a person's key (member set) or the family's setup key (member null). Raises 28000 otherwise.
create or replace function cradle.caller(p_key text, out household uuid, out member uuid)
language plpgsql stable security definer set search_path = '' as $$
declare kh bytea;
begin
  if p_key is null or length(p_key) < 20 or length(p_key) > 100 then raise exception 'bad family key' using errcode = '28000'; end if;
  kh := extensions.digest(p_key, 'sha256');
  select m.household_id, m.id into household, member from cradle.members m where m.key_hash = kh and m.removed_at is null;
  if household is null then
    select h.id into household from cradle.households h where h.key_hash = kh;
    if household is null then
      if exists (select 1 from cradle.members m where m.key_hash = kh) then
        raise exception 'removed from family' using errcode = '28000', hint = 'removed'; end if;
      raise exception 'bad family key' using errcode = '28000';
    end if;
  end if;
end $$;

-- Every existing function keeps working with a personal key.
create or replace function cradle.household_for(p_key text) returns uuid
language sql stable security definer set search_path = '' as $$ select household from cradle.caller(p_key) $$;

-- A new random secret, URL-safe, 32 characters.
create or replace function cradle.secret() returns text
language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+/', '-_') $$;

-- Saves, as before, but stamped with the person the key belongs to (the phone can't claim to be someone else).
create or replace function public.cradle_push(p_key text, p_writes jsonb, p_by text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; w jsonb; p text; del boolean; absent boolean; n int; rejected jsonb := '[]'::jsonb; who text;
begin
  select * into c from cradle.caller(p_key);
  who := coalesce(c.member::text, left(p_by, 80));
  if jsonb_typeof(p_writes) <> 'array' or jsonb_array_length(p_writes) > 100 then raise exception 'bad writes' using errcode = '22023'; end if;
  for w in select * from jsonb_array_elements(p_writes) loop
    p := w->>'path'; del := coalesce((w->>'del')::boolean, false); absent := coalesce((w->>'if_absent')::boolean, false);
    if p is null or length(p) > 300 or p !~ '^[A-Za-z0-9_.:@+~-]+(/[A-Za-z0-9_.:@+~-]+)+$' or p ~ '(^|/)[.]+(/|$)' then raise exception 'bad path %', left(coalesce(p, ''), 60) using errcode = '22023'; end if;
    if not del and (jsonb_typeof(w->'data') <> 'object' or length((w->'data')::text) > 65536) then raise exception 'bad data for %', p using errcode = '22023'; end if;
    insert into cradle.docs as d (household_id, path, data, deleted, updated_by)
      values (c.household, p, case when del then null else w->'data' end, del, who)
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

-- Who am I, and who else is in this family. {me: {id,name,color} | null, baby, members: [{id,name,color,me,last_seen,joined}]}
create or replace function public.cradle_family(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from cradle.caller(p_key);
  if c.member is not null then update cradle.members set last_seen = now() where id = c.member and (last_seen is null or last_seen < now() - interval '1 minute'); end if;
  return jsonb_build_object(
    'me', (select jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color) from cradle.members m where m.id = c.member),
    'baby', (select d.data->>'name' from cradle.docs d where d.household_id = c.household and d.path = 'baby/profile' and not d.deleted),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color, 'me', coalesce(m.id = c.member, false),
                          'last_seen', m.last_seen, 'joined', m.created_at) order by m.created_at)
                         from cradle.members m where m.household_id = c.household and m.removed_at is null), '[]'::jsonb));
end $$;

-- Make a one-time invite link code (7 days). The setup key can make one too, for the family's first person.
create or replace function public.cradle_invite(p_key text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; code text := cradle.secret(); exp timestamptz := now() + interval '7 days';
begin
  select * into c from cradle.caller(p_key);
  if (select count(*) from cradle.invites where household_id = c.household and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many invites today' using errcode = '54000'; end if;
  insert into cradle.invites (code_hash, household_id, created_by, for_name, expires_at)
    values (extensions.digest(code, 'sha256'), c.household, c.member, nullif(left(btrim(coalesce(p_name, '')), 40), ''), exp);
  return jsonb_build_object('code', code, 'expires_at', exp);
end $$;

-- What an invite link is, before joining: {ok, why: 'used'|'expired'|'unknown', by, for_name, baby}
create or replace function public.cradle_invite_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i cradle.invites;
begin
  if p_code is null or length(p_code) < 20 or length(p_code) > 100 then return jsonb_build_object('ok', false, 'why', 'unknown'); end if;
  select * into i from cradle.invites where code_hash = extensions.digest(p_code, 'sha256');
  if i.code_hash is null then return jsonb_build_object('ok', false, 'why', 'unknown'); end if;
  if i.used_at is not null then return jsonb_build_object('ok', false, 'why', 'used'); end if;
  if i.expires_at < now() then return jsonb_build_object('ok', false, 'why', 'expired'); end if;
  return jsonb_build_object('ok', true, 'for_name', i.for_name,
    'by', (select m.name from cradle.members m where m.id = i.created_by),
    'baby', (select d.data->>'name' from cradle.docs d where d.household_id = i.household_id and d.path = 'baby/profile' and not d.deleted));
end $$;

-- Use an invite: makes the person and their own key, returned once. {key, me: {id,name,color}}
create or replace function public.cradle_join(p_code text, p_name text, p_color text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i cradle.invites; k text := cradle.secret(); m uuid; nm text := left(btrim(coalesce(p_name, '')), 40);
begin
  if nm = '' then raise exception 'name needed' using errcode = '22023'; end if;
  select * into i from cradle.invites where code_hash = extensions.digest(coalesce(p_code, ''), 'sha256') for update;
  if i.code_hash is null or i.used_at is not null or i.expires_at < now() then
    raise exception 'invite not valid' using errcode = '28000', hint = case when i.code_hash is null then 'unknown' when i.used_at is not null then 'used' else 'expired' end; end if;
  insert into cradle.members (household_id, name, color, key_hash, invited_by)
    values (i.household_id, nm, left(p_color, 20), extensions.digest(k, 'sha256'), i.created_by) returning id into m;
  update cradle.invites set used_at = now(), used_by = m where code_hash = i.code_hash;
  return jsonb_build_object('key', k, 'me', jsonb_build_object('id', m, 'name', nm, 'color', left(p_color, 20)));
end $$;

create or replace function public.cradle_rename(p_key text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare c record; nm text := left(btrim(coalesce(p_name, '')), 40);
begin
  select * into c from cradle.caller(p_key);
  if c.member is null or nm = '' then return; end if;
  update cradle.members set name = nm where id = c.member;
end $$;

-- Take a person out of the family (a lost phone, a nanny who left, or yourself on a phone you're giving away).
-- Their key stops working at once; what they logged stays. The last person can't remove themselves.
create or replace function public.cradle_remove(p_key text, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from cradle.caller(p_key);
  if p_member = c.member and (select count(*) from cradle.members where household_id = c.household and removed_at is null) <= 1 then
    raise exception 'last person in the family' using errcode = '22023'; end if;
  update cradle.members set removed_at = now(), removed_by = c.member
    where id = p_member and household_id = c.household and removed_at is null;
end $$;

-- Admin view (SQL editor only): who is in each family.
create view cradle.admin_members as
  select h.label as family, m.name, m.created_at as joined, m.last_seen, m.removed_at, i.name as invited_by
  from cradle.members m join cradle.households h on h.id = m.household_id left join cradle.members i on i.id = m.invited_by
  order by h.label, m.created_at;

revoke all on all functions in schema cradle from public, anon, authenticated;
revoke all on function public.cradle_family(text), public.cradle_invite(text, text), public.cradle_invite_info(text),
  public.cradle_join(text, text, text), public.cradle_rename(text, text), public.cradle_remove(text, uuid) from public;
grant execute on function public.cradle_family(text), public.cradle_invite(text, text), public.cradle_invite_info(text),
  public.cradle_join(text, text, text), public.cradle_rename(text, text), public.cradle_remove(text, uuid) to anon, authenticated;
grant execute on function public.cradle_push(text, jsonb, text) to anon, authenticated;
