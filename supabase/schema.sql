-- Alive WhatsApp Template Management - Supabase schema
-- Run this once in your Supabase project (SQL editor).

create table if not exists whatsapp_templates (
  id uuid primary key default gen_random_uuid(),

  channel text not null default 'test',
  template_name text not null,
  category text,
  language text,
  status text,

  body_original text,
  body_meta text,
  header jsonb,

  variables_order jsonb,
  mapping jsonb,
  examples jsonb,
  buttons jsonb,

  chakra_template_id text,
  raw_request jsonb,
  raw_chakra_response jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(channel, template_name, language)
);

create index if not exists whatsapp_templates_template_name_language_idx
  on whatsapp_templates (template_name, language);

create or replace function whatsapp_templates_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists whatsapp_templates_updated_at on whatsapp_templates;

create trigger whatsapp_templates_updated_at
before update on whatsapp_templates
for each row execute function whatsapp_templates_set_updated_at();

-- API usage, rate-limit, duplicate-send, and troubleshooting logs.
create table if not exists api_usage_logs (
  id uuid primary key default gen_random_uuid(),

  request_id text not null,
  endpoint text not null,
  api_key_label text not null default 'client_main',

  phone text,
  phone_last4 text,
  template_name text,
  language text,

  idempotency_key text,
  request_hash text,
  image_url_present boolean not null default false,
  variables_keys jsonb not null default '[]'::jsonb,

  status text not null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists api_usage_logs_endpoint_key_created_idx
  on api_usage_logs (endpoint, api_key_label, created_at desc);

create index if not exists api_usage_logs_idempotency_idx
  on api_usage_logs (api_key_label, endpoint, idempotency_key, created_at desc)
  where idempotency_key is not null;

create index if not exists api_usage_logs_request_hash_idx
  on api_usage_logs (api_key_label, endpoint, request_hash, created_at desc)
  where request_hash is not null;

create index if not exists api_usage_logs_template_created_idx
  on api_usage_logs (template_name, language, created_at desc);

-- Atomically reserves one rolling-hour template-create slot. The advisory lock
-- serializes reservations per API key, while immutable `attempted` records keep
-- quota accounting independent from later accepted/failed outcome logs.
create or replace function reserve_template_create_slot(
  p_request_id text,
  p_api_key_label text,
  p_limit integer,
  p_template_name text,
  p_language text,
  p_image_url_present boolean,
  p_variables_keys jsonb
)
returns table (
  allowed boolean,
  current_count bigint,
  retry_after_seconds integer
)
language plpgsql
set search_path = public
as $$
declare
  v_count bigint;
  v_now timestamptz := clock_timestamp();
  v_oldest timestamptz;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be a positive integer';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('templates-create:' || coalesce(p_api_key_label, ''), 0)
  );

  select count(*), min(created_at)
    into v_count, v_oldest
  from api_usage_logs
  where endpoint = 'templates-create'
    and api_key_label = p_api_key_label
    and status = 'attempted'
    and created_at >= v_now - interval '1 hour';

  if v_count >= p_limit then
    return query select
      false,
      v_count,
      greatest(
        1,
        ceil(extract(epoch from ((v_oldest + interval '1 hour') - v_now)))::integer
      );
    return;
  end if;

  insert into api_usage_logs (
    request_id,
    endpoint,
    api_key_label,
    template_name,
    language,
    image_url_present,
    variables_keys,
    status,
    metadata,
    created_at
  ) values (
    p_request_id,
    'templates-create',
    p_api_key_label,
    p_template_name,
    p_language,
    coalesce(p_image_url_present, false),
    coalesce(p_variables_keys, '[]'::jsonb),
    'attempted',
    jsonb_build_object('reason', 'template_create_quota_reservation'),
    v_now
  );

  return query select true, v_count + 1, 3600;
end;
$$;

revoke all on function reserve_template_create_slot(text, text, integer, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function reserve_template_create_slot(text, text, integer, text, text, boolean, jsonb)
  to service_role;

-- Latest Alive Group Monitor export.
-- Stores only the latest successful response JSON; failure upserts update
-- metadata without overwriting the last good response.
create table if not exists alive_group_exports (
  id text primary key,
  exported_at timestamptz,
  status text not null,
  response jsonb,
  group_count integer,
  total_member_count integer,
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  updated_at timestamptz not null default now()
);

create or replace function alive_group_exports_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists alive_group_exports_updated_at on alive_group_exports;

create trigger alive_group_exports_updated_at
before update on alive_group_exports
for each row execute function alive_group_exports_set_updated_at();

-- Server-only audit trail for successful customer pulls of the latest export.
-- Does not store API keys, phone numbers, request IPs, or response JSON.
create table if not exists alive_group_pull_receipts (
  id uuid primary key default gen_random_uuid(),
  consumer_id text not null,
  requested_at timestamptz not null default now(),
  response_status integer not null check (response_status between 100 and 599),
  exported_at timestamptz,
  success boolean not null
);

create index if not exists alive_group_pull_receipts_consumer_requested_idx
  on alive_group_pull_receipts (consumer_id, requested_at desc);

alter table alive_group_pull_receipts enable row level security;

revoke all on table alive_group_pull_receipts from public, anon, authenticated, service_role;
grant select, insert on table alive_group_pull_receipts to service_role;
