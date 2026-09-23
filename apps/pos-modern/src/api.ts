import type {
  AppAccessDecision,
  CatalogSnapshot,
  CreateOrderInput,
  OrderListItem,
  OrderSummary,
  QueueTicketSummary,
  SessionPrincipal,
  StoreSummary
} from '@aevo/contracts';

export interface ApiErrorBody { error?: { code?: string; message?: string; requestId?: string } }

export class PosApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'PosApiError';
  }
}

export interface SessionResponse { user: SessionPrincipal; }
export interface AccessResponse extends AppAccessDecision { application: 'POS'; testMode?: boolean; }
export interface StaffContextResponse { principal: SessionPrincipal; stores: StoreSummary[]; currentStore: StoreSummary | null; activeCashSession: unknown; }
export interface QueueResponse { tickets: QueueTicketSummary[]; }
export interface CreateOrderResponse { order: OrderSummary; queueTicket?: QueueTicketSummary; }
export interface PayOrderResponse { order: OrderSummary; queueTicket?: QueueTicketSummary; receipt?: { receiptNumber: string; orderNumber: string; totalMinor: number }; }

export interface SsoExchangeResponse { authenticated: true; returnPath: string; }

function readCookie(name: string): string | null {
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-request-id', crypto.randomUUID());
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.body && !headers.has('x-csrf-token')) {
    const csrf = readCookie(import.meta.env.VITE_AEVO_CSRF_COOKIE_NAME || 'aevo_pos_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const body = typeof payload === 'object' && payload !== null ? payload as ApiErrorBody : {};
    throw new PosApiError(response.status, body.error?.code || 'POS_API_ERROR', body.error?.message || 'POS API request failed');
  }
  return payload as T;
}

export function exchangeSso(code: string, state: string): Promise<SsoExchangeResponse> {
  return request<SsoExchangeResponse>('/api/auth/exchange', { method: 'POST', body: JSON.stringify({ code, state }) });
}

export function getSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/api/auth/me');
}

export function getAccess(storeId?: string): Promise<AccessResponse> {
  const query = new URLSearchParams({ application: 'POS' });
  if (storeId) query.set('storeId', storeId);
  return request<AccessResponse>(`/api/v1/access?${query.toString()}`);
}

export function getContext(storeId?: string): Promise<StaffContextResponse> {
  const query = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
  return request<StaffContextResponse>(`/api/v1/staff/context${query}`);
}

export function getStores(): Promise<{ stores: StoreSummary[] }> {
  return request<{ stores: StoreSummary[] }>('/api/stores');
}

export function getCatalog(storeId: string): Promise<CatalogSnapshot> {
  return request<CatalogSnapshot>(`/api/v1/staff/catalog?storeId=${encodeURIComponent(storeId)}`);
}

export function getOrders(storeId: string): Promise<{ orders: OrderListItem[] }> {
  return request<{ orders: OrderListItem[] }>(`/api/v1/staff/orders?storeId=${encodeURIComponent(storeId)}&limit=12`);
}

export function getQueue(storeId: string): Promise<QueueResponse> {
  return request<QueueResponse>(`/api/queue?storeId=${encodeURIComponent(storeId)}&status=WAITING,PREPARING,READY`);
}

export function createStaffOrder(input: CreateOrderInput & { orderType: 'POS' }, idempotencyKey: string): Promise<CreateOrderResponse> {
  return request<CreateOrderResponse>('/api/v1/staff/orders', { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(input) });
}

export function payStaffOrder(orderId: string, input: { storeId: string; method: 'CASH'; amountMinor: number; currency: string }, idempotencyKey: string): Promise<PayOrderResponse> {
  return request<PayOrderResponse>(`/api/v1/staff/orders/${encodeURIComponent(orderId)}/pay`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(input) });
}
