/** Tokens returned by Supabase Auth and stored in the HttpOnly session cookie. */
export interface AuthSessionCookie {
  accessToken: string;
  refreshToken?: string;
}

export function isAuthSessionCookie(value: unknown): value is AuthSessionCookie {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as AuthSessionCookie).accessToken === "string" &&
    (value as AuthSessionCookie).accessToken.length > 0 &&
    ((value as AuthSessionCookie).refreshToken === undefined || typeof (value as AuthSessionCookie).refreshToken === "string")
  );
}
