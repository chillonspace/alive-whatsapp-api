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
