-- TW-01 storage on Supabase (free plan is enough).
-- Tables are private: RLS on, no policies, no grants to API roles. The only way in is through
-- SECURITY DEFINER functions that require the server secret (env TW01_DB_SECRET).
-- Before running: replace <SHA256_OF_TW01_DB_SECRET> with the hex SHA-256 of your secret, e.g.
--   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$TW01_DB_SECRET"
create extension if not exists pgcrypto with schema extensions;

create table public.tw01_config (id int primary key default 1 check (id = 1), secret_sha256 text not null);
create table public.tw01_state (key text primary key, version bigint not null default 0, data jsonb not null, updated_at timestamptz not null default now());
create table public.tw01_blobs (path text primary key, content text not null, bytes int not null, updated_at timestamptz not null default now());
alter table public.tw01_config enable row level security;
alter table public.tw01_state enable row level security;
alter table public.tw01_blobs enable row level security;
revoke all on public.tw01_config, public.tw01_state, public.tw01_blobs from anon, authenticated;
insert into public.tw01_config (id, secret_sha256) values (1, '<SHA256_OF_TW01_DB_SECRET>');

create or replace function public.tw01_check(p_secret text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_secret is null or encode(extensions.digest(p_secret, 'sha256'), 'hex') <> (select secret_sha256 from public.tw01_config where id = 1) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.tw01_load(p_secret text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.tw01_check(p_secret);
  select version, data into r from public.tw01_state where key = p_key;
  if not found then return null; end if;
  return jsonb_build_object('version', r.version, 'data', r.data);
end $$;

-- Compare-and-swap: writes only if the stored version equals p_expected (0 = must not exist). Returns new version, or -1 on conflict.
create or replace function public.tw01_save(p_secret text, p_key text, p_expected bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform public.tw01_check(p_secret);
  if p_expected = 0 then
    insert into public.tw01_state (key, version, data) values (p_key, 1, p_data) on conflict (key) do nothing;
    if found then return 1; end if;
    return -1;
  end if;
  update public.tw01_state set version = version + 1, data = p_data, updated_at = now()
   where key = p_key and version = p_expected returning version into v;
  if v is null then return -1; end if;
  return v;
end $$;

create or replace function public.tw01_blob_put(p_secret text, p_path text, p_content text) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public.tw01_check(p_secret);
  insert into public.tw01_blobs (path, content, bytes) values (p_path, p_content, octet_length(p_content))
  on conflict (path) do update set content = excluded.content, bytes = excluded.bytes, updated_at = now();
  return octet_length(p_content);
end $$;

create or replace function public.tw01_blob_get(p_secret text, p_path text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  perform public.tw01_check(p_secret);
  select content into c from public.tw01_blobs where path = p_path;
  return c;
end $$;

create or replace function public.tw01_blob_delete(p_secret text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.tw01_check(p_secret);
  delete from public.tw01_blobs where path = p_path;
end $$;

revoke all on function public.tw01_check(text) from public, anon, authenticated;
revoke execute on function public.tw01_load(text, text), public.tw01_save(text, text, bigint, jsonb),
  public.tw01_blob_put(text, text, text), public.tw01_blob_get(text, text), public.tw01_blob_delete(text, text) from public, authenticated;
grant execute on function public.tw01_load(text, text), public.tw01_save(text, text, bigint, jsonb),
  public.tw01_blob_put(text, text, text), public.tw01_blob_get(text, text), public.tw01_blob_delete(text, text) to anon;
