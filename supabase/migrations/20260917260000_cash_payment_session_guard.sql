-- Cash payments must belong to an open drawer session. Enforce this at the
-- database boundary so direct API calls and retries cannot bypass the POS UI.
CREATE OR REPLACE FUNCTION public.require_open_cash_session_for_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.method = 'CASH' AND NOT EXISTS (
    SELECT 1
    FROM public.cash_sessions
    WHERE organization_id = NEW.organization_id
      AND store_id = NEW.store_id
      AND status = 'OPEN'
  ) THEN
    RAISE EXCEPTION USING
      errcode = '22023',
      message = 'An open cash session is required before accepting cash payment';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payments_require_open_cash_session ON public.payments;
CREATE TRIGGER payments_require_open_cash_session
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.require_open_cash_session_for_payment();

REVOKE ALL ON FUNCTION public.require_open_cash_session_for_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_open_cash_session_for_payment() TO service_role;
