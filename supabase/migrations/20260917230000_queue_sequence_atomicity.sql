-- Allocate queue numbers under a row lock so concurrent checkouts cannot
-- receive the same number. A sentinel date keeps sequences continuous when a
-- store disables its daily reset.
CREATE UNIQUE INDEX IF NOT EXISTS queue_tickets_order_unique_idx
  ON public.queue_tickets (organization_id, order_id);

CREATE OR REPLACE FUNCTION public.next_queue_number(
  p_organization_id uuid,
  p_store_id uuid,
  p_business_date date
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_sequence integer;
BEGIN
  IF p_business_date IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Queue business date is required';
  END IF;

  INSERT INTO public.queue_sequences (organization_id, store_id, business_date, next_value)
  VALUES (p_organization_id, p_store_id, p_business_date, 2)
  ON CONFLICT (organization_id, store_id, business_date)
  DO UPDATE SET next_value = public.queue_sequences.next_value + 1
  RETURNING next_value - 1 INTO v_sequence;

  RETURN v_sequence;
END;
$function$;

REVOKE ALL ON FUNCTION public.next_queue_number(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_queue_number(uuid, uuid, date) TO service_role;
