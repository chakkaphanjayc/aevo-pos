-- Refunds are a Store Core command, not a plain order status update. Keep the
-- refund row, order state, payment state and outbox event in one transaction.
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_idx
  ON public.cash_sessions (organization_id, store_id)
  WHERE status = 'OPEN';

CREATE OR REPLACE FUNCTION public.record_order_refund(
  p_organization_id uuid,
  p_store_id uuid,
  p_order_id uuid,
  p_created_by uuid,
  p_amount_minor integer,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE(
  refund_id uuid,
  order_id uuid,
  order_status text,
  payment_status text,
  refunded_amount_minor integer,
  idempotent boolean
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order_status text;
  v_payment_status text;
  v_order_total integer;
  v_paid_total integer;
  v_refunded_total integer;
  v_new_refunded_total integer;
  v_available integer;
  v_refund_id uuid;
  v_existing_response jsonb;
  v_scope text := 'refund.create:' || p_order_id::text;
  v_event_type text;
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Refund amount must be positive';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Refund reason is required';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) < 8 OR length(btrim(p_idempotency_key)) > 200 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Idempotency-Key must be between 8 and 200 characters';
  END IF;

  p_idempotency_key := btrim(p_idempotency_key);
  INSERT INTO public.idempotency_keys (organization_id, user_id, scope, key, expires_at)
  VALUES (p_organization_id, p_created_by, v_scope, p_idempotency_key, timezone('utc', now()) + interval '1 day')
  ON CONFLICT (organization_id, scope, key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT i.response_body
      INTO v_existing_response
    FROM public.idempotency_keys i
    WHERE i.organization_id = p_organization_id
      AND i.scope = v_scope
      AND i.key = p_idempotency_key
    FOR UPDATE;
    IF v_existing_response->>'refundId' IS NULL THEN
      RAISE EXCEPTION USING errcode = '40001', message = 'The previous refund request is still in progress';
    END IF;
    RETURN QUERY
      SELECT (v_existing_response->>'refundId')::uuid,
             p_order_id,
             v_existing_response->>'orderStatus',
             v_existing_response->>'paymentStatus',
             (v_existing_response->>'refundedAmountMinor')::integer,
             true;
    RETURN;
  END IF;

  SELECT o.status, o.payment_status, o.total_minor
    INTO v_order_status, v_payment_status, v_order_total
  FROM public.orders o
  WHERE o.organization_id = p_organization_id
    AND o.store_id = p_store_id
    AND o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Order was not found in the selected store';
  END IF;
  IF v_order_status IN ('DRAFT', 'PENDING_PAYMENT', 'CANCELLED', 'NO_SHOW') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Refund is not available for this order status';
  END IF;

  SELECT coalesce(sum(pay.amount_minor), 0)
    INTO v_paid_total
  FROM public.payments pay
  WHERE pay.organization_id = p_organization_id
    AND pay.order_id = p_order_id
    AND pay.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

  SELECT coalesce(sum(r.amount_minor), 0)
    INTO v_refunded_total
  FROM public.refunds r
  WHERE r.organization_id = p_organization_id
    AND r.order_id = p_order_id
    AND r.status = 'COMPLETED';

  v_available := greatest(v_paid_total - v_refunded_total, 0);
  IF p_amount_minor > v_available THEN
    RAISE EXCEPTION USING errcode = '22023', message = format('Refund amount exceeds the remaining refundable amount of %s', v_available);
  END IF;

  v_refund_id := gen_random_uuid();
  INSERT INTO public.refunds (
    id, organization_id, store_id, order_id, amount_minor, status, reason, created_by
  ) VALUES (
    v_refund_id, p_organization_id, p_store_id, p_order_id, p_amount_minor, 'COMPLETED', btrim(p_reason), p_created_by
  );

  v_new_refunded_total := v_refunded_total + p_amount_minor;
  IF v_new_refunded_total >= v_paid_total THEN
    v_order_status := 'REFUNDED';
    v_payment_status := 'REFUNDED';
    UPDATE public.payments
    SET status = 'REFUNDED', updated_at = timezone('utc', now())
    WHERE organization_id = p_organization_id
      AND order_id = p_order_id
      AND status IN ('PAID', 'PARTIALLY_REFUNDED');
  ELSE
    v_order_status := 'PARTIALLY_REFUNDED';
    v_payment_status := 'PARTIALLY_REFUNDED';
    UPDATE public.payments
    SET status = 'PARTIALLY_REFUNDED', updated_at = timezone('utc', now())
    WHERE organization_id = p_organization_id
      AND order_id = p_order_id
      AND status = 'PAID';
  END IF;

  UPDATE public.orders
  SET status = v_order_status,
      payment_status = v_payment_status,
      version = version + 1,
      updated_at = timezone('utc', now())
  WHERE organization_id = p_organization_id
    AND id = p_order_id;

  v_event_type := CASE WHEN v_order_status = 'REFUNDED' THEN 'order.refunded' ELSE 'order.partially_refunded' END;
  INSERT INTO public.domain_events (organization_id, event_type, aggregate_type, aggregate_id, payload, metadata)
  VALUES (
    p_organization_id,
    v_event_type,
    'order',
    p_order_id,
    jsonb_build_object('orderId', p_order_id, 'refundId', v_refund_id, 'amountMinor', p_amount_minor, 'refundedAmountMinor', v_new_refunded_total),
    jsonb_build_object('actorId', p_created_by, 'source', 'refund_service', 'reason', btrim(p_reason))
  );
  INSERT INTO public.outbox_events (domain_event_id, organization_id)
  SELECT de.id, de.organization_id
  FROM public.domain_events de
  WHERE de.aggregate_id = p_order_id
    AND de.event_type = v_event_type
  ORDER BY de.created_at DESC
  LIMIT 1;

  UPDATE public.idempotency_keys
  SET resource_id = v_refund_id,
      response_status = 201,
      response_body = jsonb_build_object(
        'refundId', v_refund_id,
        'orderStatus', v_order_status,
        'paymentStatus', v_payment_status,
        'refundedAmountMinor', v_new_refunded_total
      )
  WHERE organization_id = p_organization_id
    AND scope = v_scope
    AND key = p_idempotency_key;

  RETURN QUERY SELECT v_refund_id, p_order_id, v_order_status, v_payment_status, v_new_refunded_total, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_order_refund(uuid, uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_refund(uuid, uuid, uuid, uuid, integer, text, text) TO service_role;
