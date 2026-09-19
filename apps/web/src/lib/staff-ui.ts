import type { SessionPrincipal, StoreSummary } from "@aevo/contracts";
import { api, ApiError } from "./api";
import { enforceDeviceMode } from "./device-mode";

export interface StaffContext {
  user: SessionPrincipal;
  stores: StoreSummary[];
}

export interface StaffShellOptions {
  user: SessionPrincipal;
  stores: StoreSummary[];
  selectedStoreId?: string;
  redirectOnStoreChange?: boolean;
  onStoreChange?: (storeId: string) => void | Promise<void>;
}

interface CachedStaffContext {
  cachedAt: number;
  context: StaffContext;
}

// v2 invalidates contexts created before the role/permission and device
// surfaces were added. Permissions must never remain stale after deployment.
const STAFF_CONTEXT_CACHE_KEY = "aevo.staff.context.v2";
const STAFF_CONTEXT_CACHE_TTL_MS = 30_000;
let staffContextRequest: Promise<StaffContext> | null = null;

const roleLabels: Record<SessionPrincipal["role"], string> = {
  OWNER: "เจ้าขององค์กร",
  ADMIN: "ผู้ดูแลระบบ",
  BRANCH_MANAGER: "ผู้จัดการสาขา",
  CASHIER: "แคชเชียร์",
  KITCHEN: "ครัว",
  STAFF: "พนักงาน",
  VIEWER: "ผู้ดูข้อมูล"
};

export async function loadStaffContext(): Promise<StaffContext> {
  const cached = readCachedStaffContext();
  if (cached && Date.now() - cached.cachedAt < STAFF_CONTEXT_CACHE_TTL_MS) {
    return cached.context;
  }

  if (!staffContextRequest) {
    staffContextRequest = fetchStaffContext().then((context) => {
      writeCachedStaffContext(context);
      return context;
    }).finally(() => {
      staffContextRequest = null;
    });
  }

  return staffContextRequest.catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.code === "UNAUTHORIZED") window.location.assign("/login");
    throw cause;
  });
}

async function fetchStaffContext(): Promise<StaffContext> {
  const [{ user }, { stores }] = await Promise.all([
    api<{ user: SessionPrincipal }>("/api/auth/me"),
    api<{ stores: StoreSummary[] }>("/api/stores")
  ]);
  return { user, stores };
}

function readCachedStaffContext(): CachedStaffContext | null {
  try {
    const raw = sessionStorage.getItem(STAFF_CONTEXT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStaffContext;
    if (!parsed || typeof parsed.cachedAt !== "number" || !parsed.context?.user || !Array.isArray(parsed.context.stores)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedStaffContext(context: StaffContext): void {
  try {
    const value: CachedStaffContext = { cachedAt: Date.now(), context };
    sessionStorage.setItem(STAFF_CONTEXT_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing; network remains the source of truth.
  }
}

export function getSelectedStoreId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("store");
  return fromUrl || sessionStorage.getItem("aevo.selectedStoreId") || "";
}

export function findSelectedStore(stores: StoreSummary[], requestedId: string): StoreSummary | undefined {
  return stores.find((store) => store.id === requestedId) ?? stores[0];
}

export function storeUrl(path: string, storeId: string, params?: Record<string, string>): string {
  const url = new URL(path, window.location.origin);
  if (storeId) url.searchParams.set("store", storeId);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export function friendlyErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    const messages: Record<string, string> = {
      UNAUTHORIZED: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง",
      FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ใช้งานข้อมูลของสาขานี้",
      STORE_NOT_FOUND: "ไม่พบสาขานี้หรือสาขาถูกปิดใช้งาน",
      CATALOG_CONFLICT: "ข้อมูลนี้มีอยู่แล้ว กรุณาตรวจสอบชื่อหรือรหัสอีกครั้ง",
      SCHEMA_NOT_READY: "ระบบฐานข้อมูลยังติดตั้งไม่ครบ กรุณาแจ้งผู้ดูแลระบบให้รัน migration",
      NETWORK_ERROR: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่เมื่อสัญญาณพร้อม"
    };
    return messages[cause.code] ?? (cause.status >= 500 ? fallback : cause.message);
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function updateStoreLinks(storeId: string): void {
  document.querySelectorAll<HTMLAnchorElement>("[data-staff-store-link]").forEach((link) => {
    const rawHref = link.dataset.baseHref ?? link.getAttribute("href") ?? "/staff";
    link.dataset.baseHref = rawHref;
    const url = new URL(rawHref, window.location.origin);
    if (storeId) {
      url.searchParams.set("store", storeId);
      link.href = `${url.pathname}${url.search}`;
      link.classList.remove("is-disabled");
      link.removeAttribute("aria-disabled");
    } else {
      link.href = "/staff";
      link.classList.add("is-disabled");
      link.setAttribute("aria-disabled", "true");
    }
  });
}

function updateStoreLabel(store?: StoreSummary): void {
  document.querySelectorAll<HTMLElement>("[data-staff-store-name]").forEach((element) => {
    element.textContent = store?.name ?? "เลือกสาขา";
  });
  document.querySelectorAll<HTMLElement>("[data-staff-store-code]").forEach((element) => {
    element.textContent = store?.code ?? "—";
  });
}

function updatePermissionVisibility(permissions: SessionPrincipal["permissions"]): void {
  const granted = new Set(permissions);
  document.querySelectorAll<HTMLElement>("[data-staff-permission]").forEach((element) => {
    const required = element.dataset.staffPermission;
    if (!required) return;
    const visible = granted.has(required as SessionPrincipal["permissions"][number]);
    element.hidden = !visible;
    element.setAttribute("aria-hidden", String(!visible));
  });
}

function setConnectionState(): void {
  const status = document.querySelector<HTMLElement>("[data-staff-connection]");
  if (!status) return;
  const online = navigator.onLine;
  status.textContent = online ? "ออนไลน์" : "ออฟไลน์";
  status.dataset.state = online ? "online" : "offline";
  status.classList.toggle("is-offline", !online);
}

function setDrawerOpen(open: boolean): void {
  const drawer = document.querySelector<HTMLElement>("#staff-mobile-drawer");
  const scrim = document.querySelector<HTMLElement>("#staff-scrim");
  const toggle = document.querySelector<HTMLButtonElement>("#staff-menu-toggle");
  if (!drawer || !scrim || !toggle) return;
  drawer.classList.toggle("is-open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  toggle.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
  document.body.classList.toggle("staff-drawer-open", open);
}

export function initStaffShell(options: StaffShellOptions): () => void {
  enforceDeviceMode();
  let selectedStoreId = options.selectedStoreId && options.stores.some((store) => store.id === options.selectedStoreId)
    ? options.selectedStoreId
    : "";
  let switching = false;

  const select = document.querySelector<HTMLSelectElement>("#staff-store-select");
  const userName = document.querySelector<HTMLElement>("[data-staff-user-name]");
  const userRole = document.querySelector<HTMLElement>("[data-staff-user-role]");
  const tenant = document.querySelector<HTMLElement>("[data-staff-tenant]");
  const logout = document.querySelector<HTMLButtonElement>("#logout");
  const menuToggle = document.querySelector<HTMLButtonElement>("#staff-menu-toggle");
  const menuClose = document.querySelector<HTMLButtonElement>("#staff-mobile-close");
  const menuMore = document.querySelector<HTMLButtonElement>("#staff-bottom-more");
  const scrim = document.querySelector<HTMLElement>("#staff-scrim");

  if (userName) userName.textContent = options.user.displayName || options.user.email;
  if (userRole) userRole.textContent = roleLabels[options.user.role] ?? options.user.role;
  if (tenant) tenant.textContent = `องค์กร · ${options.user.organizationId.slice(0, 8)}`;
  updatePermissionVisibility(options.user.permissions);

  if (select) {
    select.replaceChildren();
    if (options.stores.length === 0) {
      select.add(new Option("ยังไม่มีสาขา", ""));
      select.disabled = true;
    } else {
      for (const store of options.stores) select.add(new Option(`${store.name} · ${store.code}`, store.id));
      if (!selectedStoreId) selectedStoreId = options.stores[0]?.id ?? "";
      select.value = selectedStoreId;
    }
  }

  const syncContext = (storeId: string): void => {
    selectedStoreId = storeId;
    const store = options.stores.find((item) => item.id === storeId);
    updateStoreLabel(store);
    updateStoreLinks(storeId);
    if (select && select.value !== storeId) select.value = storeId;
    if (storeId) sessionStorage.setItem("aevo.selectedStoreId", storeId);
  };

  syncContext(selectedStoreId);
  setConnectionState();

  const onStoreChange = async (): Promise<void> => {
    if (!select || switching || !select.value) return;
    const nextStoreId = select.value;
    const previousStoreId = selectedStoreId;
    switching = true;
    select.disabled = true;
    syncContext(nextStoreId);
    try {
      if (options.redirectOnStoreChange) {
        window.location.assign(storeUrl("/staff/workspace", nextStoreId));
        return;
      }
      await options.onStoreChange?.(nextStoreId);
    } catch (cause) {
      syncContext(previousStoreId);
      select.value = previousStoreId;
      throw cause;
    } finally {
      switching = false;
      select.disabled = options.stores.length === 0;
    }
  };

  const onSelectChange = (): void => {
    void onStoreChange().catch(() => undefined);
  };
  select?.addEventListener("change", onSelectChange);

  const onLogout = async (): Promise<void> => {
    if (!logout) return;
    logout.disabled = true;
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      sessionStorage.removeItem("aevo.selectedStoreId");
      sessionStorage.removeItem(STAFF_CONTEXT_CACHE_KEY);
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith("aevo.staff.orders.v1.")) sessionStorage.removeItem(key);
      }
      window.location.assign("/login");
    }
  };
  const onLogoutClick = (): void => { void onLogout(); };
  logout?.addEventListener("click", onLogoutClick);

  const closeMenu = (): void => setDrawerOpen(false);
  const openMenu = (): void => setDrawerOpen(true);
  const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-staff-nav-link]"));
  menuToggle?.addEventListener("click", openMenu);
  menuClose?.addEventListener("click", closeMenu);
  menuMore?.addEventListener("click", openMenu);
  scrim?.addEventListener("click", closeMenu);
  navLinks.forEach((link) => link.addEventListener("click", closeMenu));

  const onOnline = (): void => setConnectionState();
  const onOffline = (): void => setConnectionState();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    select?.removeEventListener("change", onSelectChange);
    logout?.removeEventListener("click", onLogoutClick);
    menuToggle?.removeEventListener("click", openMenu);
    menuClose?.removeEventListener("click", closeMenu);
    menuMore?.removeEventListener("click", openMenu);
    scrim?.removeEventListener("click", closeMenu);
    navLinks.forEach((link) => link.removeEventListener("click", closeMenu));
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
