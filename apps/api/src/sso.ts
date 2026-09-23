export interface SsoFlow {
  state: string;
  verifier: string;
  returnPath: string;
  expiresAt: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

export async function createSsoFlow(returnPath: string, secret: string): Promise<{ flow: SsoFlow; cookieValue: string; codeChallenge: string }> {
  const flow: SsoFlow = { state: randomToken(), verifier: randomToken(), returnPath, expiresAt: Date.now() + 5 * 60 * 1000 };
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(flow)));
  const signature = await hmac(payload, secret);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier));
  return { flow, cookieValue: `${payload}.${signature}`, codeChallenge: bytesToBase64Url(new Uint8Array(digest)) };
}

export async function readSsoFlow(cookieValue: string | null, secret: string): Promise<SsoFlow | null> {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature || signature !== await hmac(payload, secret)) return null;
  try {
    const flow = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as Partial<SsoFlow>;
    if (typeof flow.state !== "string" || typeof flow.verifier !== "string" || typeof flow.returnPath !== "string" || typeof flow.expiresAt !== "number" || flow.expiresAt <= Date.now() || !flow.returnPath.startsWith("/") || flow.returnPath.startsWith("//") || flow.returnPath.includes("\\")) return null;
    return flow as SsoFlow;
  } catch {
    return null;
  }
}

export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return "/";
  return value;
}
