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

/** A dead token means the session is over — drop it and send the user to login. */
function unauthenticated(): void {
  if (typeof window === "undefined") return;
  setToken(null);
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
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

  if (response.status === 401) unauthenticated();

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, body.message ?? "حدث خطأ غير متوقع", body.errors);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

/** Reports bytes moved so far; `total` is null when the size is not known up front. */
export type ProgressFn = (loaded: number, total: number | null) => void;

export interface TransferOptions {
  onProgress?: ProgressFn;
  signal?: AbortSignal;
}

/**
 * Multipart POST (uploads). Laravel only reads files from POST bodies, so updates
 * spoof the verb with `_method=PUT` inside the form itself.
 *
 * Deliberately XMLHttpRequest and not fetch: fetch cannot report upload progress
 * at all. A streaming request body is the fetch answer and it needs HTTP/2 plus
 * `duplex: "half"`, which Safari still does not ship — so for a 17 MB scan on a
 * 5 Mbit/s line, XHR is the only way to show a percentage instead of a 30-second
 * spinner. Everything else about the request is unchanged.
 */
export function apiForm<T = unknown>(
  path: string,
  form: FormData,
  { onProgress, signal }: TransferOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}${path}`);
    request.setRequestHeader("Accept", "application/json");
    request.setRequestHeader("Accept-Language", "ar");
    const token = getToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);

    if (onProgress) {
      request.upload.onprogress = (event) =>
        onProgress(event.loaded, event.lengthComputable ? event.total : null);
    }

    const abort = () => request.abort();
    signal?.addEventListener("abort", abort);

    const settle = () => signal?.removeEventListener("abort", abort);

    request.onload = () => {
      settle();
      let body: { message?: string; errors?: Record<string, string[]> } = {};
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = { message: request.statusText };
      }

      if (request.status === 401) unauthenticated();

      if (request.status >= 200 && request.status < 300) {
        resolve(body as T);
      } else {
        reject(new ApiError(request.status, body.message ?? "حدث خطأ غير متوقع", body.errors));
      }
    };

    request.onerror = () => {
      settle();
      reject(new ApiError(0, "تعذر الاتصال بالخادم"));
    };

    request.onabort = () => {
      settle();
      reject(new DOMException("Aborted", "AbortError"));
    };

    request.send(form);
  });
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

/**
 * Authenticated file download (Authorization headers don't work on `<a href>`, so
 * the bytes have to come through JS and land as a blob).
 *
 * The body is consumed a chunk at a time rather than with `response.blob()` so the
 * caller can report progress. `blob()` resolves only once the last byte has landed,
 * which is why this used to look frozen for ~30 seconds on a large file.
 */
export async function downloadFile(
  path: string,
  filename: string,
  { onProgress, signal }: TransferOptions = {},
): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Accept: "application/octet-stream",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    signal,
  });

  if (response.status === 401) unauthenticated();
  if (!response.ok) throw new ApiError(response.status, "تعذر تحميل الملف");

  // Laravel sends Content-Length on every download, so the percentage is real.
  const header = response.headers.get("Content-Length");
  const total = header ? Number(header) : null;
  const size = total !== null && Number.isFinite(total) ? total : null;

  let blob: Blob;

  if (!response.body || !onProgress) {
    blob = await response.blob();
    onProgress?.(blob.size, size ?? blob.size);
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, size);
    }

    blob = new Blob(chunks as BlobPart[], {
      type: response.headers.get("Content-Type") ?? "application/octet-stream",
    });
  }

  saveBlob(blob, filename);
}

/**
 * Hand a blob to the browser's save flow.
 *
 * The anchor is attached to the document before clicking (Firefox ignores a
 * detached one) and the object URL is revoked on a later tick — revoking it in the
 * same turn as `.click()` races the browser's own read of it and can truncate the
 * file or drop the download outright.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 30_000);
}

/**
 * POST that returns a document, opened in a new tab (M9b letterhead preview).
 *
 * The object URL is kept alive deliberately — revoking it immediately would blank
 * the tab that just opened it. The browser reclaims it when the tab closes.
 */
export async function openRendered(path: string, form?: FormData): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/pdf",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    // Deliberately no Content-Type: the browser must set the multipart boundary.
    ...(form ? { body: form } : {}),
  });
  if (!response.ok) {
    // A validation failure comes back as JSON even though we asked for a PDF.
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.message ?? "تعذر إنشاء المعاينة", body?.errors);
  }

  window.open(URL.createObjectURL(await response.blob()), "_blank", "noopener");
}
