/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL?: string;
  readonly PUBLIC_AEVO_HUB_URL?: string;
  readonly AEVO_HUB_WEB_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
