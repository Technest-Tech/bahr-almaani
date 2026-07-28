const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const TOKEN_KEY = "bahr_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = options;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      Accept: "application/json",
      "Accept-Language": "ar",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (response.status === 401 && typeof window !== "undefined") {
    setToken(null);
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, body.message ?? "حدث خطأ غير متوقع", body.errors);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

/**
 * Multipart POST (uploads). Laravel only reads files from POST bodies, so updates
 * spoof the verb with `_method=PUT` inside the form itself.
 */
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "ar",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, body.message ?? "حدث خطأ غير متوقع", body.errors);
  }

  return response.json();
}

/** Authenticated binary fetch for previews — `<img src>` cannot carry a bearer token. */
export async function fetchBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Accept: "*/*",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (!response.ok) throw new ApiError(response.status, "تعذر تحميل المعاينة");

  return response.blob();
}

/** Authenticated file download via blob (Authorization headers don't work on <a href>). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Accept: "application/octet-stream",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (!response.ok) throw new ApiError(response.status, "تعذر تحميل الملف");

  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * POST that returns a document, opened in a new tab (M9b letterhead preview).
 *
 * The object URL is kept alive deliberately — revoking it immediately would blank
 * the tab that just opened it. The browser reclaims it when the tab closes.
 */
export async function openRendered(path: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/pdf",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (!response.ok) throw new ApiError(response.status, "تعذر إنشاء المعاينة");

  window.open(URL.createObjectURL(await response.blob()), "_blank", "noopener");
}
