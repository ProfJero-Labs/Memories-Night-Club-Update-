-- Memories on Supabase: the whole database is one table of documents (collection, id, JSON data,
-- version), the same shape the app already uses on Firebase. Only the Worker (the service role) can
-- touch it: row-level security is on with no policies, and nothing is granted to the public roles.
-- The Worker talks to it through the functions below (called as /rest/v1/rpc/<name>).

create table if not exists public.docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  version    bigint      not null default 1,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs enable row level security;
revoke all on public.docs from anon, authenticated;

-- Equality lookups ("tabs where status = open and waiterUid = x") are data @> '{...}'.
create index if not exists docs_data_idx on public.docs using gin (data jsonb_path_ops);
-- "Newest first" lookups, by the date fields the app uses.
create index if not exists docs_created_idx   on public.docs (col, (data->>'createdAt'));
create index if not exists docs_at_idx        on public.docs (col, (data->>'at'));
create index if not exists docs_stored_idx    on public.docs (col, (data->>'storedAt'));
create index if not exists docs_recorded_idx  on public.docs (col, (data->>'recordedAt'));
create index if not exists docs_requested_idx on public.docs (col, (data->>'requestedAt'));
create index if not exists docs_paid_idx      on public.docs (col, (data->>'paidAt'));

-- One document: { id, data, version } or null.
create or replace function public.m_get(p_col text, p_id text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', id, 'data', data, 'version', version) from docs where col = p_col and id = p_id;
$$;

-- Several documents at once, in the order asked: [{ col, id, found, data?, version? }].
create or replace function public.m_batch_get(p_keys jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(
    case when d.id is null then jsonb_build_object('col', e.v->>'col', 'id', e.v->>'id', 'found', false)
         else jsonb_build_object('col', d.col, 'id', d.id, 'found', true, 'data', d.data, 'version', d.version) end
    order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_keys, '[]'::jsonb)) with ordinality as e(v, ord)
  left join docs d on d.col = e.v->>'col' and d.id = e.v->>'id';
$$;

-- Documents of a collection whose fields equal p_filter (an empty filter lists them all), in id order,
-- after p_after when paging: [{ id, data, version }].
create or replace function public.m_query(p_col text, p_filter jsonb default '{}'::jsonb, p_limit int default 1000, p_after text default null) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data, 'version', t.version) order by t.id), '[]'::jsonb)
  from (select id, data, version from docs
        where col = p_col and data @> coalesce(p_filter, '{}'::jsonb) and (p_after is null or id > p_after)
        order by id limit greatest(p_limit, 0)) t;
$$;

-- Newest first: documents whose date field (an ISO text, so it sorts as time) is at or after p_since.
create or replace function public.m_recent(p_col text, p_field text, p_since text, p_limit int default 50) returns jsonb
language plpgsql stable set search_path = public as $$
declare result jsonb;
begin
  execute format($f$
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data, 'version', t.version) order by t.k desc, t.id), '[]'::jsonb)
    from (select id, data, version, data->>%1$L as k from docs
          where col = $1 and (data->>%1$L) >= $2
          order by (data->>%1$L) desc, id limit greatest($3, 0)) t$f$, p_field)
  into result using p_col, p_since, p_limit;
  return result;
end $$;

-- All-or-nothing save, like a Firestore transaction.
--   p_reads:  [{ col, id, version }]  what the caller read (version 0 = it wasn't there); if any of
--             those changed since, nothing is written and the answer is 409 ABORTED (the caller retries).
--   p_writes: [{ op: 'set'|'delete', col, id, data?, exists? }]  in order. exists:false = only if the
--             document isn't there yet (409 ALREADY_EXISTS), exists:true = only if it is (404).
-- Every document involved is locked first, in one fixed order, so two saves can't deadlock.
create or replace function public.m_commit(p_reads jsonb, p_writes jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  r record; w jsonb; cur bigint; n int; wrote int := 0;
begin
  perform 1 from docs d
    join (select e.value->>'col' as c, e.value->>'id' as i from jsonb_array_elements(coalesce(p_reads, '[]'::jsonb)) e
          union
          select e.value->>'col', e.value->>'id' from jsonb_array_elements(coalesce(p_writes, '[]'::jsonb)) e) k
      on d.col = k.c and d.id = k.i
    order by d.col, d.id for update of d;

  for r in select value from jsonb_array_elements(coalesce(p_reads, '[]'::jsonb)) loop
    select version into cur from docs where col = r.value->>'col' and id = r.value->>'id';
    if not found then
      if (r.value->>'version')::bigint <> 0 then raise sqlstate 'PT409' using message = 'ABORTED: a document changed since it was read'; end if;
    elsif cur <> (r.value->>'version')::bigint then
      raise sqlstate 'PT409' using message = 'ABORTED: a document changed since it was read';
    end if;
  end loop;

  for w in select value from jsonb_array_elements(coalesce(p_writes, '[]'::jsonb)) loop
    if w->>'op' = 'delete' then
      delete from docs where col = w->>'col' and id = w->>'id';
    elsif w ? 'exists' and (w->>'exists')::boolean = false then
      insert into docs (col, id, data) values (w->>'col', w->>'id', coalesce(w->'data', '{}'::jsonb)) on conflict do nothing;
      get diagnostics n = row_count;
      if n = 0 then raise sqlstate 'PT409' using message = 'ALREADY_EXISTS: document already exists: ' || (w->>'col') || '/' || (w->>'id'); end if;
    elsif w ? 'exists' and (w->>'exists')::boolean = true then
      update docs set data = coalesce(w->'data', '{}'::jsonb), version = version + 1, updated_at = now() where col = w->>'col' and id = w->>'id';
      get diagnostics n = row_count;
      if n = 0 then raise sqlstate 'PT404' using message = 'NOT_FOUND: ' || (w->>'col') || '/' || (w->>'id'); end if;
    else
      insert into docs (col, id, data) values (w->>'col', w->>'id', coalesce(w->'data', '{}'::jsonb))
        on conflict (col, id) do update set data = excluded.data, version = docs.version + 1, updated_at = now();
    end if;
    wrote := wrote + 1;
  end loop;
  return jsonb_build_object('ok', true, 'writes', wrote);
end $$;

-- Only the Worker (service role) may call them.
revoke all on function public.m_get(text, text), public.m_batch_get(jsonb), public.m_query(text, jsonb, int, text),
  public.m_recent(text, text, text, int), public.m_commit(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.m_get(text, text), public.m_batch_get(jsonb), public.m_query(text, jsonb, int, text),
  public.m_recent(text, text, text, int), public.m_commit(jsonb, jsonb) to service_role;
