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
