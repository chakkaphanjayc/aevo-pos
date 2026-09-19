import type {
  AppCatalogItem,
  AppEntitlement,
  AppSubscriptionSummary,
  BookableResourceSummary,
  BookingSummary,
  BookingWaitlistSummary,
  CashMovementSummary,
  CashSessionSummary,
  CreateOrderInput,
  DailyClosingSummary,
  DeviceSummary,
  MemberSummary,
  OrderListItem,
  OrderSummary,
  OrganizationSummary,
  PreparationStationSummary,
  PreparationTaskSummary,
  QueueDisplaySnapshot,
  QueueTicketSummary,
  Role,
  SessionPrincipal,
  StoreSummary,
  VenueSummary
} from "@aevo/contracts";

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface GatewayClientConfig {
  baseUrl?: string;
  organizationId?: string;
  storeId?: string;
  deviceToken?: string;
}

export class GatewayClient {
  private baseUrl: string;
  private organizationId?: string;
  private storeId?: string;
  private deviceToken?: string;

  constructor(config: GatewayClientConfig = {}) {
    const configuredApi = typeof import.meta !== "undefined" && import.meta.env?.PUBLIC_API_URL
      ? String(import.meta.env.PUBLIC_API_URL)
      : "";
    this.baseUrl = (config.baseUrl ?? configuredApi).replace(/\/$/, "");
    this.organizationId = config.organizationId;
    this.storeId = config.storeId;
    this.deviceToken = config.deviceToken;
  }

  setOrganizationId(orgId: string | undefined): void {
    this.organizationId = orgId;
    if (typeof window !== "undefined") {
      if (orgId) localStorage.setItem("aevo.hub.activeOrgId", orgId);
      else localStorage.removeItem("aevo.hub.activeOrgId");
    }
  }

  setStoreId(storeId: string | undefined): void {
    this.storeId = storeId;
    if (typeof window !== "undefined") {
      if (storeId) localStorage.setItem("aevo.hub.activeStoreId", storeId);
      else localStorage.removeItem("aevo.hub.activeStoreId");
    }
  }

  setDeviceToken(token: string | undefined): void {
    this.deviceToken = token;
  }

  getOrganizationId(): string | undefined {
    if (this.organizationId) return this.organizationId;
    if (typeof window !== "undefined") {
      return localStorage.getItem("aevo.hub.activeOrgId") || undefined;
    }
    return undefined;
  }

  getStoreId(): string | undefined {
    if (this.storeId) return this.storeId;
    if (typeof window !== "undefined") {
      return localStorage.getItem("aevo.hub.activeStoreId") || undefined;
    }
    return undefined;
  }

  getDeviceToken(): string | undefined {
    if (this.deviceToken) return this.deviceToken;
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("aevo.device.session.v1");
        if (!raw) return undefined;
        const session = JSON.parse(raw) as { deviceToken?: string };
        return session.deviceToken;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");

    const orgId = this.getOrganizationId();
    if (orgId && !headers.has("x-organization-id")) {
      headers.set("x-organization-id", orgId);
    }

    const storeId = this.getStoreId();
    if (storeId && !headers.has("x-store-id")) {
      headers.set("x-store-id", storeId);
    }

    const deviceToken = this.getDeviceToken();
    if (deviceToken && !headers.has("x-device-token")) {
      headers.set("x-device-token", deviceToken);
    }

    if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        ...options,
        credentials: "include",
        headers
      });

      // Auto token refresh on 401
      if (response.status === 401 && !path.includes("/auth/login") && !path.includes("/auth/refresh")) {
        const refreshRes = await fetch(`${this.baseUrl}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json" }
        });
        if (refreshRes.ok) {
          response = await fetch(url, {
            ...options,
            credentials: "include",
            headers
          });
        }
      }
    } catch {
      throw new GatewayError("ไม่สามารถเชื่อมต่อ Aevo Gateway ได้ กรุณาลองใหม่อีกครั้ง", 0, "GATEWAY_NETWORK_ERROR");
    }

    if (!response.ok) {
      const errorJson = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      throw new GatewayError(
        errorJson?.error?.message ?? `Gateway request failed with status ${response.status}`,
        response.status,
        errorJson?.error?.code ?? "GATEWAY_ERROR",
        errorJson?.error?.details
      );
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // ==========================================
  // SURFACE 1: Aevo Hub Management API Client
  // ==========================================
  readonly hub = {
    getMe: (): Promise<{ principal: SessionPrincipal }> =>
      this.request<{ principal: SessionPrincipal }>("/api/v1/hub/me"),

    getOrganizations: (): Promise<{ organizations: OrganizationSummary[] }> =>
      this.request<{ organizations: OrganizationSummary[] }>("/api/v1/hub/organizations"),

    createOrganization: (input: { name: string; slug?: string }): Promise<{ organization: OrganizationSummary }> =>
      this.request<{ organization: OrganizationSummary }>("/api/v1/hub/organizations", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getStores: (organizationId?: string): Promise<{ stores: StoreSummary[] }> => {
      const q = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
      return this.request<{ stores: StoreSummary[] }>(`/api/v1/hub/stores${q}`);
    },

    createStore: (input: {
      organizationId?: string;
      name: string;
      code: string;
      timezone?: string;
    }): Promise<{ store: StoreSummary }> =>
      this.request<{ store: StoreSummary }>("/api/v1/hub/stores", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getApps: (): Promise<{ apps: AppCatalogItem[] }> =>
      this.request<{ apps: AppCatalogItem[] }>("/api/v1/hub/apps"),

    getSubscriptions: (storeId?: string): Promise<{ subscriptions: AppSubscriptionSummary[] }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ subscriptions: AppSubscriptionSummary[] }>(`/api/v1/hub/subscriptions${q}`);
    },

    getEntitlement: (appId: string, storeId?: string): Promise<{ entitlement: AppEntitlement }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ entitlement: AppEntitlement }>(`/api/v1/hub/entitlements/${encodeURIComponent(appId)}${q}`);
    },

    startTrial: (appId: string, storeId?: string): Promise<{ subscription: AppSubscriptionSummary }> =>
      this.request<{ subscription: AppSubscriptionSummary }>("/api/v1/hub/subscriptions/trial", {
        method: "POST",
        body: JSON.stringify({ appId, ...(storeId ? { storeId } : {}) })
      }),

    getMembers: (): Promise<{ members: MemberSummary[] }> =>
      this.request<{ members: MemberSummary[] }>("/api/v1/hub/members"),

    updateMember: (
      membershipId: string,
      input: { role?: Role; customPermissions?: string[] }
    ): Promise<{ member: MemberSummary }> =>
      this.request<{ member: MemberSummary }>(`/api/v1/hub/members/${encodeURIComponent(membershipId)}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      }),

    getAuditLogs: (query: { limit?: number; action?: string; resourceType?: string } = {}): Promise<{ logs: any[] }> => {
      const params = new URLSearchParams();
      if (query.limit) params.set("limit", String(query.limit));
      if (query.action) params.set("action", query.action);
      if (query.resourceType) params.set("resourceType", query.resourceType);
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ logs: any[] }>(`/api/v1/hub/audit-logs${q}`);
    },

    getStats: (): Promise<{ stats: { totalApps: number; activeApps: number; totalStores: number; totalMembers: number } }> =>
      this.request<{ stats: { totalApps: number; activeApps: number; totalStores: number; totalMembers: number } }>("/api/v1/hub/stats"),

    getBillingPortal: (returnUrl?: string): Promise<{ url: string }> =>
      this.request<{ url: string }>("/api/v1/hub/billing/portal", {
        method: "POST",
        body: JSON.stringify({ ...(returnUrl ? { returnUrl } : {}) })
      })
  };

  // ==========================================
  // SURFACE 2: Staff & POS Operations Client
  // ==========================================
  readonly staff = {
    getContext: (storeId?: string): Promise<{
      principal: SessionPrincipal;
      stores: StoreSummary[];
      currentStore: StoreSummary | null;
      activeCashSession: CashSessionSummary | null;
    }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request(`/api/v1/staff/context${q}`);
    },

    getCatalog: (storeId?: string, channel?: string): Promise<any> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (channel) params.set("channel", channel);
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request(`/api/v1/staff/catalog${q}`);
    },

    getOrders: (query: { storeId?: string; status?: string; limit?: number } = {}): Promise<{ orders: OrderListItem[] }> => {
      const params = new URLSearchParams();
      if (query.storeId) params.set("storeId", query.storeId);
      if (query.status) params.set("status", query.status);
      if (query.limit) params.set("limit", String(query.limit));
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ orders: OrderListItem[] }>(`/api/v1/staff/orders${q}`);
    },

    getOrder: (orderId: string, storeId?: string): Promise<{ order: OrderSummary }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ order: OrderSummary }>(`/api/v1/staff/orders/${encodeURIComponent(orderId)}${q}`);
    },

    createOrder: (input: CreateOrderInput, idempotencyKey?: string): Promise<{ order: OrderSummary; queueTicket: QueueTicketSummary }> =>
      this.request<{ order: OrderSummary; queueTicket: QueueTicketSummary }>("/api/v1/staff/orders", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey || crypto.randomUUID() }
      }),

    payOrder: (
      orderId: string,
      input: {
        storeId: string;
        method: "CASH" | "PROMPTPAY" | "EXTERNAL_CARD" | "MANUAL";
        amountMinor: number;
        currency?: string;
        providerReference?: string;
      },
      idempotencyKey?: string
    ): Promise<{ order: OrderSummary; queueTicket: QueueTicketSummary; receipt: any }> =>
      this.request(`/api/v1/staff/orders/${encodeURIComponent(orderId)}/pay`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey || crypto.randomUUID() }
      }),

    refundOrder: (
      orderId: string,
      input: { storeId: string; amountMinor: number; reason: string },
      idempotencyKey?: string
    ): Promise<{ refund: any }> =>
      this.request(`/api/v1/staff/orders/${encodeURIComponent(orderId)}/refund`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey || crypto.randomUUID() }
      }),

    transitionOrder: (
      orderId: string,
      input: { storeId: string; toStatus: string; expectedStatus?: string; reason?: string },
      idempotencyKey?: string
    ): Promise<{ order: OrderSummary }> =>
      this.request(`/api/v1/staff/orders/${encodeURIComponent(orderId)}/transition`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey || crypto.randomUUID() }
      }),

    getCurrentCashSession: (storeId?: string): Promise<{ session: CashSessionSummary | null }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ session: CashSessionSummary | null }>(`/api/v1/staff/cash-sessions/current${q}`);
    },

    openCashSession: (input: {
      storeId: string;
      openingAmountMinor: number;
      notes?: string;
    }): Promise<{ session: CashSessionSummary }> =>
      this.request<{ session: CashSessionSummary }>("/api/v1/staff/cash-sessions/open", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    recordCashMovement: (input: {
      storeId: string;
      cashSessionId: string;
      movementType: "IN" | "OUT" | "PAID_IN" | "PAID_OUT";
      amountMinor: number;
      reason: string;
    }): Promise<{ movement: CashMovementSummary }> =>
      this.request<{ movement: CashMovementSummary }>("/api/v1/staff/cash-sessions/movement", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    closeCashSession: (input: {
      storeId: string;
      cashSessionId: string;
      countedAmountMinor: number;
      notes?: string;
    }): Promise<{ session: CashSessionSummary }> =>
      this.request<{ session: CashSessionSummary }>("/api/v1/staff/cash-sessions/close", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getCashSessionsHistory: (storeId?: string, limit?: number): Promise<{ sessions: CashSessionSummary[] }> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (limit) params.set("limit", String(limit));
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ sessions: CashSessionSummary[] }>(`/api/v1/staff/cash-sessions/history${q}`);
    },

    createDailyClosing: (input: { storeId: string; closingDate: string }): Promise<{ closing: DailyClosingSummary }> =>
      this.request<{ closing: DailyClosingSummary }>("/api/v1/staff/reports/closing/daily", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getDailyClosing: (storeId?: string, date?: string): Promise<{ closing: DailyClosingSummary | null }> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (date) params.set("date", date);
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ closing: DailyClosingSummary | null }>(`/api/v1/staff/reports/closing/daily${q}`);
    },

    getDailyClosingHistory: (storeId?: string, limit?: number): Promise<{ closings: DailyClosingSummary[] }> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (limit) params.set("limit", String(limit));
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ closings: DailyClosingSummary[] }>(`/api/v1/staff/reports/closing/history${q}`);
    },

    getReportsSummary: (storeId?: string, date?: string): Promise<{ summary: any }> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (date) params.set("date", date);
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ summary: any }>(`/api/v1/staff/reports/summary${q}`);
    },

    getVenues: (storeId?: string): Promise<{ venues: VenueSummary[] }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ venues: VenueSummary[] }>(`/api/v1/staff/booking/venues${q}`);
    },

    createVenue: (input: {
      storeId?: string;
      name: string;
      slug: string;
      description?: string;
      address?: string;
      timezone?: string;
      slotDurationMinutes?: number;
    }): Promise<{ venue: VenueSummary }> =>
      this.request<{ venue: VenueSummary }>("/api/v1/staff/booking/venues", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getResources: (venueId: string): Promise<{ resources: BookableResourceSummary[] }> =>
      this.request<{ resources: BookableResourceSummary[] }>(`/api/v1/staff/booking/resources?venueId=${encodeURIComponent(venueId)}`),

    createResource: (input: {
      venueId: string;
      name: string;
      type: "COURT" | "ROOM" | "STUDIO" | "TABLE" | "EQUIPMENT";
      capacity?: number;
      basePriceMinor?: number;
    }): Promise<{ resource: BookableResourceSummary }> =>
      this.request<{ resource: BookableResourceSummary }>("/api/v1/staff/booking/resources", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getBookings: (venueId: string, query: { date?: string; resourceId?: string } = {}): Promise<{ bookings: BookingSummary[] }> => {
      const params = new URLSearchParams();
      params.set("venueId", venueId);
      if (query.date) params.set("date", query.date);
      if (query.resourceId) params.set("resourceId", query.resourceId);
      return this.request<{ bookings: BookingSummary[] }>(`/api/v1/staff/booking/bookings?${params.toString()}`);
    },

    createBooking: (input: {
      venueId: string;
      resourceId: string;
      customerName: string;
      customerPhone?: string;
      customerEmail?: string;
      startAt: string;
      endAt: string;
      amountMinor: number;
      notes?: string;
      orderId?: string;
    }): Promise<{ booking: BookingSummary }> =>
      this.request<{ booking: BookingSummary }>("/api/v1/staff/booking/bookings", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    checkinBooking: (bookingId: string, code?: string): Promise<{ booking: BookingSummary }> =>
      this.request<{ booking: BookingSummary }>(`/api/v1/staff/booking/bookings/${encodeURIComponent(bookingId)}/checkin`, {
        method: "POST",
        body: JSON.stringify({ ...(code ? { code } : {}) })
      }),

    getWaitlists: (venueId: string): Promise<{ waitlists: BookingWaitlistSummary[] }> =>
      this.request<{ waitlists: BookingWaitlistSummary[] }>(`/api/v1/staff/booking/waitlists?venueId=${encodeURIComponent(venueId)}`),

    addToWaitlist: (input: {
      venueId: string;
      resourceId?: string;
      customerName: string;
      customerPhone?: string;
      customerEmail?: string;
      partySize: number;
      requestedSlot: string;
      notes?: string;
    }): Promise<{ waitlist: BookingWaitlistSummary }> =>
      this.request<{ waitlist: BookingWaitlistSummary }>("/api/v1/staff/booking/waitlists", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    updateWaitlistStatus: (waitlistId: string, status: string): Promise<{ waitlist: BookingWaitlistSummary }> =>
      this.request<{ waitlist: BookingWaitlistSummary }>(`/api/v1/staff/booking/waitlists/${encodeURIComponent(waitlistId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      }),

    getQueueTickets: (storeId?: string, status?: string): Promise<{ tickets: QueueTicketSummary[] }> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (status) params.set("status", status);
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ tickets: QueueTicketSummary[] }>(`/api/v1/staff/queue/tickets${q}`);
    },

    transitionQueueTicket: (ticketId: string, status: string): Promise<{ ticket: QueueTicketSummary }> =>
      this.request<{ ticket: QueueTicketSummary }>(`/api/v1/staff/queue/tickets/${encodeURIComponent(ticketId)}/transition`, {
        method: "POST",
        body: JSON.stringify({ status })
      }),

    getPreparationStations: (storeId?: string): Promise<{ stations: PreparationStationSummary[] }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ stations: PreparationStationSummary[] }>(`/api/v1/staff/preparation/stations${q}`);
    },

    getPreparationTasks: (storeId?: string, query: { stationId?: string; status?: string } = {}): Promise<{ tasks: PreparationTaskSummary[] }> => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (query.stationId) params.set("stationId", query.stationId);
      if (query.status) params.set("status", query.status);
      const q = params.toString() ? `?${params.toString()}` : "";
      return this.request<{ tasks: PreparationTaskSummary[] }>(`/api/v1/staff/preparation/tasks${q}`);
    },

    completePreparationTask: (taskId: string, storeId: string): Promise<{ task: PreparationTaskSummary }> =>
      this.request<{ task: PreparationTaskSummary }>(`/api/v1/staff/preparation/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST",
        body: JSON.stringify({ storeId })
      }),

    getDevices: (storeId?: string): Promise<{ devices: DeviceSummary[] }> => {
      const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : "";
      return this.request<{ devices: DeviceSummary[] }>(`/api/v1/staff/devices${q}`);
    },

    createDevice: (input: {
      storeId: string;
      name: string;
      mode: "POS" | "KIOSK" | "KDS" | "QUEUE_DISPLAY";
    }): Promise<{ device: DeviceSummary; pairingCode: string; pairingExpiresAt: string }> =>
      this.request<{ device: DeviceSummary; pairingCode: string; pairingExpiresAt: string }>("/api/v1/staff/devices", {
        method: "POST",
        body: JSON.stringify(input)
      }),

    revokeDevice: (deviceId: string, storeId: string): Promise<{ ok: boolean }> =>
      this.request<{ ok: boolean }>(`/api/v1/staff/devices/${encodeURIComponent(deviceId)}/revoke`, {
        method: "POST",
        body: JSON.stringify({ storeId })
      })
  };

  // ==========================================
  // SURFACE 3: Public Consumer Client
  // ==========================================
  readonly public = {
    getMenu: (storeCode: string): Promise<any> =>
      this.request(`/api/v1/public/stores/${encodeURIComponent(storeCode)}/menu`),

    createOrder: (storeCode: string, input: any, idempotencyKey?: string): Promise<{ order: any; trackingToken?: string }> =>
      this.request(`/api/v1/public/stores/${encodeURIComponent(storeCode)}/orders`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey || crypto.randomUUID() }
      }),

    trackOrder: (token: string, storeCode: string): Promise<{ order: any }> =>
      this.request(`/api/v1/public/orders/track/${encodeURIComponent(token)}?storeCode=${encodeURIComponent(storeCode)}`),

    getVenueAvailability: (venueSlug: string, date: string): Promise<{ date: string; slots: any }> =>
      this.request(`/api/v1/public/venues/${encodeURIComponent(venueSlug)}/availability?date=${encodeURIComponent(date)}`),

    createBooking: (venueSlug: string, input: any): Promise<{ booking: any }> =>
      this.request(`/api/v1/public/venues/${encodeURIComponent(venueSlug)}/bookings`, {
        method: "POST",
        body: JSON.stringify(input)
      }),

    getQueueSnapshot: (storeCode: string): Promise<{ snapshot: QueueDisplaySnapshot }> =>
      this.request<{ snapshot: QueueDisplaySnapshot }>(`/api/v1/public/queue/${encodeURIComponent(storeCode)}/snapshot`)
  };

  // ==========================================
  // SURFACE 4: Device & Kiosk Terminal Client
  // ==========================================
  readonly device = {
    pair: (pairingCode: string): Promise<{
      device: DeviceSummary;
      deviceToken: string;
      storeCode: string;
      storeName: string;
    }> =>
      this.request("/api/v1/device/pair", {
        method: "POST",
        body: JSON.stringify({ pairingCode })
      }),

    getContext: (): Promise<{ device: DeviceSummary; store: any }> =>
      this.request("/api/v1/device/context"),

    getCatalog: (): Promise<any> =>
      this.request("/api/v1/device/catalog"),

    createOrder: (input: any, idempotencyKey?: string): Promise<{ order: any; trackingToken?: string }> =>
      this.request("/api/v1/device/orders", {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "idempotency-key": idempotencyKey || crypto.randomUUID() }
      }),

    getPreparation: (): Promise<{ stations: any[]; tasks: any[] }> =>
      this.request("/api/v1/device/preparation")
  };
}

export const gateway = new GatewayClient();
