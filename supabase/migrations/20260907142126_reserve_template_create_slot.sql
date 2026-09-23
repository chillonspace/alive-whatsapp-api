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
