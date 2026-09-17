import type { DeviceMode, DeviceSummary } from "@aevo/contracts";

export interface DeviceSession {
  deviceToken: string;
  device: DeviceSummary;
  storeCode?: string;
  pairedAt: number;
}

const DEVICE_SESSION_KEY = "aevo.device.session.v1";

export function readDeviceSession(): DeviceSession | null {
  try {
    const raw = localStorage.getItem(DEVICE_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as DeviceSession;
    if (!value?.deviceToken || !value.device?.mode || !value.device?.storeId) return null;
    return value;
  } catch {
    return null;
  }
}

export function deviceHeaders(): Record<string, string> {
  const session = readDeviceSession();
  return session ? { "x-device-token": session.deviceToken } : {};
}

function allowedPath(mode: DeviceMode, pathname: string): boolean {
  if (mode === "POS") return pathname === "/staff/pos" || pathname === "/staff/pos/";
  if (mode === "KDS") return pathname === "/staff/kds" || pathname === "/staff/kds/" || pathname === "/staff/preparation" || pathname === "/staff/preparation/";
  if (mode === "KIOSK") return pathname.startsWith("/kiosk/");
  return pathname.startsWith("/queue/");
}

export function enforceDeviceMode(): void {
  const session = readDeviceSession();
  if (!session || allowedPath(session.device.mode, window.location.pathname)) return;
  const storeCode = session.storeCode ? encodeURIComponent(session.storeCode) : "";
  const destination = session.device.mode === "POS"
    ? "/staff/pos"
    : session.device.mode === "KDS"
      ? "/staff/kds"
      : session.device.mode === "KIOSK"
        ? `/kiosk/${storeCode}`
        : `/queue/${storeCode}`;
  window.location.replace(destination);
}
