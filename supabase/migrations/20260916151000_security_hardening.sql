-- Revoke the default PUBLIC EXECUTE grant from Supabase's optional RLS event
-- trigger helper. It is an internal event-trigger function, not a Data API RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
