-- The invite preview also says which colours the family already uses, so a new person gets a different dot.
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
    'baby', (select d.data->>'name' from cradle.docs d where d.household_id = i.household_id and d.path = 'baby/profile' and not d.deleted),
    'taken', coalesce((select jsonb_agg(distinct m.color) from cradle.members m where m.household_id = i.household_id and m.removed_at is null and m.color is not null), '[]'::jsonb));
end $$;
