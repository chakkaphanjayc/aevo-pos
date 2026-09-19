import type {
  AddWaitlistInput,
  BookableResourceSummary,
  BookableResourceType,
  BookingSlotSummary,
  BookingStatus,
  BookingSummary,
  BookingWaitlistSummary,
  OperatingHourSummary,
  SessionPrincipal,
  VenueAvailabilitySummary,
  VenueSummary,
  WaitlistStatus
} from "@aevo/contracts";
import type { Database } from "./client";
import { throwDatabaseError } from "./errors";

type Row = Record<string, unknown>;

function mapVenue(row: Row): VenueSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    storeId: row.store_id ? String(row.store_id) : undefined,
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description ?? ""),
    address: String(row.address ?? ""),
    timezone: String(row.timezone ?? "Asia/Bangkok"),
    slotDurationMinutes: Number(row.slot_duration_minutes ?? 60),
    status: row.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapResource(row: Row): BookableResourceSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    venueId: String(row.venue_id),
    name: String(row.name),
    resourceType: String(row.resource_type ?? "COURT") as BookableResourceType,
    capacity: Number(row.capacity ?? 1),
    basePriceMinor: Number(row.base_price_minor ?? 0),
    status: (row.status ?? "ACTIVE") as "ACTIVE" | "INACTIVE" | "MAINTENANCE",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapBooking(row: Row): BookingSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    venueId: String(row.venue_id),
    resourceId: String(row.resource_id),
    orderId: row.order_id ? String(row.order_id) : undefined,
    customerName: String(row.customer_name),
    customerPhone: row.customer_phone ? String(row.customer_phone) : undefined,
    customerEmail: row.customer_email ? String(row.customer_email) : undefined,
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    status: (row.status ?? "CONFIRMED") as BookingStatus,
    amountMinor: Number(row.amount_minor ?? 0),
    checkinCode: row.checkin_code ? String(row.checkin_code) : undefined,
    checkedInAt: row.checked_in_at ? String(row.checked_in_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export async function listVenues(
  database: Database,
  principal: SessionPrincipal,
  storeId?: string
): Promise<VenueSummary[]> {
  let query = database.client
    .from("venues")
    .select("id,organization_id,store_id,name,slug,description,address,timezone,slot_duration_minutes,status,created_at,updated_at")
    .eq("organization_id", principal.organizationId);

  if (storeId) {
    query = query.or(`store_id.eq.${storeId},store_id.is.null`);
  }

  const result = await query.order("name", { ascending: true });
  throwDatabaseError(result.error, "list venues");
  if (!result.data) return [];
  return (result.data as Row[]).map(mapVenue);
}

export async function createVenue(
  database: Database,
  principal: SessionPrincipal,
  input: {
    name: string;
    slug: string;
    storeId?: string | undefined;
    description?: string | undefined;
    address?: string | undefined;
    timezone?: string | undefined;
    slotDurationMinutes?: number | undefined;
  }
): Promise<VenueSummary> {
  const result = await database.client
    .from("venues")
    .insert({
      organization_id: principal.organizationId,
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      store_id: input.storeId ?? null,
      description: input.description ?? "",
      address: input.address ?? "",
      timezone: input.timezone ?? "Asia/Bangkok",
      slot_duration_minutes: input.slotDurationMinutes ?? 60,
      status: "ACTIVE"
    })
    .select("id,organization_id,store_id,name,slug,description,address,timezone,slot_duration_minutes,status,created_at,updated_at")
    .single();

  throwDatabaseError(result.error, "create venue");
  return mapVenue(result.data as Row);
}

export async function listResources(
  database: Database,
  principal: SessionPrincipal,
  venueId: string
): Promise<BookableResourceSummary[]> {
  const result = await database.client
    .from("bookable_resources")
    .select("id,organization_id,venue_id,name,resource_type,capacity,base_price_minor,status,created_at,updated_at")
    .eq("organization_id", principal.organizationId)
    .eq("venue_id", venueId)
    .order("name", { ascending: true });

  throwDatabaseError(result.error, "list resources");
  if (!result.data) return [];
  return (result.data as Row[]).map(mapResource);
}

export async function createResource(
  database: Database,
  principal: SessionPrincipal,
  input: {
    venueId: string;
    name: string;
    resourceType?: BookableResourceType | undefined;
    capacity?: number | undefined;
    basePriceMinor: number;
  }
): Promise<BookableResourceSummary> {
  const result = await database.client
    .from("bookable_resources")
    .insert({
      organization_id: principal.organizationId,
      venue_id: input.venueId,
      name: input.name.trim(),
      resource_type: input.resourceType ?? "COURT",
      capacity: input.capacity ?? 1,
      base_price_minor: input.basePriceMinor,
      status: "ACTIVE"
    })
    .select("id,organization_id,venue_id,name,resource_type,capacity,base_price_minor,status,created_at,updated_at")
    .single();

  throwDatabaseError(result.error, "create resource");
  return mapResource(result.data as Row);
}

export async function listBookings(
  database: Database,
  principal: SessionPrincipal,
  venueId: string,
  options?: { date?: string | undefined; resourceId?: string | undefined }
): Promise<BookingSummary[]> {
  let query = database.client
    .from("bookings")
    .select("id,organization_id,venue_id,resource_id,order_id,customer_name,customer_phone,customer_email,start_at,end_at,status,amount_minor,checkin_code,checked_in_at,notes,created_at,updated_at")
    .eq("organization_id", principal.organizationId)
    .eq("venue_id", venueId);

  if (options?.resourceId) {
    query = query.eq("resource_id", options.resourceId);
  }

  if (options?.date) {
    const dayStart = `${options.date}T00:00:00.000Z`;
    const dayEnd = `${options.date}T23:59:59.999Z`;
    query = query.gte("start_at", dayStart).lte("start_at", dayEnd);
  }

  const result = await query.order("start_at", { ascending: true });
  throwDatabaseError(result.error, "list bookings");
  if (!result.data) return [];
  return (result.data as Row[]).map(mapBooking);
}

export function generateCheckinCode(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function createBooking(
  database: Database,
  principal: SessionPrincipal,
  input: {
    venueId: string;
    resourceId: string;
    customerName: string;
    customerPhone?: string | undefined;
    customerEmail?: string | undefined;
    startAt: string;
    endAt: string;
    amountMinor: number;
    notes?: string | undefined;
    orderId?: string | undefined;
  }
): Promise<BookingSummary> {
  // Check for overlapping active bookings on this resource
  const existingBookings = await database.client
    .from("bookings")
    .select("id,start_at,end_at,status")
    .eq("organization_id", principal.organizationId)
    .eq("resource_id", input.resourceId)
    .in("status", ["HELD", "CONFIRMED", "CHECKED_IN"])
    .lt("start_at", input.endAt)
    .gt("end_at", input.startAt);

  throwDatabaseError(existingBookings.error, "check booking overlap");
  if (existingBookings.data && existingBookings.data.length > 0) {
    throw new Error("ช่วงเวลาดังกล่าวมีผู้จองแล้ว กรุณาเลือกช่วงเวลาอื่น");
  }

  const checkinCode = generateCheckinCode();

  const result = await database.client
    .from("bookings")
    .insert({
      organization_id: principal.organizationId,
      venue_id: input.venueId,
      resource_id: input.resourceId,
      order_id: input.orderId ?? null,
      customer_name: input.customerName.trim(),
      customer_phone: input.customerPhone ?? null,
      customer_email: input.customerEmail ?? null,
      start_at: input.startAt,
      end_at: input.endAt,
      status: "CONFIRMED",
      amount_minor: input.amountMinor,
      checkin_code: checkinCode,
      notes: input.notes ?? null
    })
    .select("id,organization_id,venue_id,resource_id,order_id,customer_name,customer_phone,customer_email,start_at,end_at,status,amount_minor,checkin_code,checked_in_at,notes,created_at,updated_at")
    .single();

  throwDatabaseError(result.error, "create booking");
  return mapBooking(result.data as Row);
}

export async function checkinBooking(
  database: Database,
  principal: SessionPrincipal,
  bookingId: string,
  code?: string | undefined
): Promise<BookingSummary> {
  let query = database.client
    .from("bookings")
    .select("id,organization_id,venue_id,resource_id,order_id,customer_name,customer_phone,customer_email,start_at,end_at,status,amount_minor,checkin_code,checked_in_at,notes,created_at,updated_at")
    .eq("organization_id", principal.organizationId)
    .eq("id", bookingId);

  if (code) {
    query = query.eq("checkin_code", code.trim().toUpperCase());
  }

  const existing = await query.maybeSingle();
  throwDatabaseError(existing.error, "find booking for checkin");
  if (!existing.data) {
    throw new Error("ไม่พบรายการจองหรือรหัส Check-in ไม่ถูกต้อง");
  }

  const now = new Date().toISOString();
  const updateResult = await database.client
    .from("bookings")
    .update({
      status: "CHECKED_IN",
      checked_in_at: now
    })
    .eq("id", bookingId)
    .select("id,organization_id,venue_id,resource_id,order_id,customer_name,customer_phone,customer_email,start_at,end_at,status,amount_minor,checkin_code,checked_in_at,notes,created_at,updated_at")
    .single();

  throwDatabaseError(updateResult.error, "perform checkin");
  return mapBooking(updateResult.data as Row);
}

export async function getVenueAvailability(
  database: Database,
  principal: SessionPrincipal,
  venueId: string,
  dateStr: string
): Promise<VenueAvailabilitySummary> {
  // Fetch venue
  const venueResult = await database.client
    .from("venues")
    .select("id,name,timezone,slot_duration_minutes")
    .eq("organization_id", principal.organizationId)
    .eq("id", venueId)
    .single();
  throwDatabaseError(venueResult.error, "fetch venue");
  const venue = venueResult.data as Row;

  // Fetch active resources
  const resources = await listResources(database, principal, venueId);
  const activeResources = resources.filter((r) => r.status === "ACTIVE");

  // Fetch bookings for the date
  const bookings = await listBookings(database, principal, venueId, { date: dateStr });

  const slotMinutes = Number(venue.slot_duration_minutes ?? 60);
  const slots: BookingSlotSummary[] = [];

  // Generate slots for each resource between 08:00 and 22:00
  const openHour = 8;
  const closeHour = 22;

  for (const resource of activeResources) {
    let currentHour = openHour;
    let currentMin = 0;

    while (currentHour * 60 + currentMin + slotMinutes <= closeHour * 60) {
      const nextTotalMin = currentHour * 60 + currentMin + slotMinutes;
      const nextHour = Math.floor(nextTotalMin / 60);
      const nextMin = nextTotalMin % 60;

      const pad = (n: number) => String(n).padStart(2, "0");
      const localStart = `${pad(currentHour)}:${pad(currentMin)}`;
      const localEnd = `${pad(nextHour)}:${pad(nextMin)}`;

      const startIso = `${dateStr}T${localStart}:00.000Z`;
      const endIso = `${dateStr}T${localEnd}:00.000Z`;

      // Check if slot is booked
      const isBooked = bookings.some(
        (b) =>
          b.resourceId === resource.id &&
          b.status !== "CANCELLED" &&
          new Date(b.startAt).getTime() < new Date(endIso).getTime() &&
          new Date(b.endAt).getTime() > new Date(startIso).getTime()
      );

      slots.push({
        id: `${resource.id}-${localStart}`,
        venueId,
        resourceId: resource.id,
        startAt: startIso,
        endAt: endIso,
        localStartTime: localStart,
        localEndTime: localEnd,
        priceMinor: resource.basePriceMinor,
        available: !isBooked,
        ...(isBooked ? { reason: "BOOKED" as const } : {})
      });

      currentHour = nextHour;
      currentMin = nextMin;
    }
  }

  return {
    venueId,
    date: dateStr,
    timezone: String(venue.timezone ?? "Asia/Bangkok"),
    slotDurationMinutes: slotMinutes,
    slots
  };
}

function mapWaitlist(row: Row): BookingWaitlistSummary {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    venueId: String(row.venue_id),
    resourceId: row.resource_id ? String(row.resource_id) : undefined,
    customerName: String(row.customer_name),
    customerPhone: row.customer_phone ? String(row.customer_phone) : undefined,
    partySize: Number(row.party_size ?? 1),
    status: (row.status ?? "WAITING") as WaitlistStatus,
    position: Number(row.position ?? 1),
    estimatedWaitMinutes: row.estimated_wait_minutes ? Number(row.estimated_wait_minutes) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export async function listWaitlists(
  database: Database,
  principal: SessionPrincipal,
  venueId: string,
  options: { status?: WaitlistStatus | undefined } = {}
): Promise<BookingWaitlistSummary[]> {
  let query = database.client
    .from("booking_waitlists")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("venue_id", venueId)
    .order("position", { ascending: true });

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const result = await query;
  if (result.error) throwDatabaseError(result.error, "list booking waitlists");
  return (result.data ?? []).map((row) => mapWaitlist(row as Row));
}

export async function addToWaitlist(
  database: Database,
  principal: SessionPrincipal,
  input: AddWaitlistInput
): Promise<BookingWaitlistSummary> {
  const existing = await database.client
    .from("booking_waitlists")
    .select("position")
    .eq("organization_id", principal.organizationId)
    .eq("venue_id", input.venueId)
    .eq("status", "WAITING")
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition = (existing.data && existing.data[0]?.position ? Number(existing.data[0].position) : 0) + 1;

  const result = await database.client
    .from("booking_waitlists")
    .insert({
      organization_id: principal.organizationId,
      venue_id: input.venueId,
      resource_id: input.resourceId ?? null,
      customer_name: input.customerName.trim(),
      customer_phone: input.customerPhone?.trim() ?? null,
      party_size: input.partySize,
      status: "WAITING",
      position: nextPosition,
      estimated_wait_minutes: input.estimatedWaitMinutes ?? null
    })
    .select("*")
    .single();

  if (result.error) throwDatabaseError(result.error, "add to booking waitlist");
  return mapWaitlist(result.data as Row);
}

export async function updateWaitlistStatus(
  database: Database,
  principal: SessionPrincipal,
  waitlistId: string,
  status: WaitlistStatus
): Promise<BookingWaitlistSummary> {
  const result = await database.client
    .from("booking_waitlists")
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq("organization_id", principal.organizationId)
    .eq("id", waitlistId)
    .select("*")
    .single();

  if (result.error) throwDatabaseError(result.error, "update waitlist status");
  return mapWaitlist(result.data as Row);
}
