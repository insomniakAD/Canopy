// ============================================================================
// Vercel Blob Source — read-only client for Golf's WDS data dump
// ============================================================================
// Server-side only. The BLOB_READ_WRITE_TOKEN must never reach the browser.
// Next.js keeps it out of bundles automatically as long as it isn't prefixed
// with NEXT_PUBLIC_ and this module is only imported from server code
// (route handlers, server components, server actions).
//
// All blobs in Golf's storage share the same shape:
//   { fields: string[], rows: unknown[][] }
// — column-oriented table dumps. fetchBlobJson() validates the shape.

import { list } from "@vercel/blob";

const TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

function getToken(): string {
  const t = process.env[TOKEN_ENV];
  if (!t) {
    throw new Error(
      `${TOKEN_ENV} is not set. Add it to .env / Vercel environment variables.`,
    );
  }
  return t;
}

export type BlobInfo = {
  pathname: string;
  url: string;
  downloadUrl: string;
  size: number;
  uploadedAt: Date;
};

export type BlobTable = {
  fields: string[];
  rows: unknown[][];
};

export async function listBlobs(): Promise<BlobInfo[]> {
  const out: BlobInfo[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ token: getToken(), cursor, limit: 1000 });
    for (const b of res.blobs) {
      out.push({
        pathname: b.pathname,
        url: b.url,
        downloadUrl: b.downloadUrl,
        size: b.size,
        uploadedAt: b.uploadedAt,
      });
    }
    cursor = res.cursor;
  } while (cursor);
  return out;
}

export async function findBlob(pathname: string): Promise<BlobInfo | null> {
  const res = await list({ token: getToken(), prefix: pathname, limit: 10 });
  const match = res.blobs.find((b) => b.pathname === pathname);
  if (!match) return null;
  return {
    pathname: match.pathname,
    url: match.url,
    downloadUrl: match.downloadUrl,
    size: match.size,
    uploadedAt: match.uploadedAt,
  };
}

/**
 * Fetch several blobs in parallel, keyed by pathname.
 * Used when one Canopy source ingests data from multiple blobs (e.g.
 * factory POs join porder-recent.json header data with cont-det.json line items).
 */
export async function fetchBlobsJson(
  pathnames: string[],
): Promise<Map<string, BlobTable>> {
  const entries = await Promise.all(
    pathnames.map(async (p) => [p, await fetchBlobJson(p)] as const),
  );
  return new Map(entries);
}

export async function fetchBlobJson(pathname: string): Promise<BlobTable> {
  const blob = await findBlob(pathname);
  if (!blob) throw new Error(`Blob not found: ${pathname}`);

  const r = await fetch(blob.downloadUrl ?? blob.url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!r.ok) {
    throw new Error(
      `Blob fetch failed for ${pathname}: HTTP ${r.status} ${r.statusText}`,
    );
  }
  const data = await r.json();
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { fields?: unknown }).fields) ||
    !Array.isArray((data as { rows?: unknown }).rows)
  ) {
    throw new Error(
      `Blob ${pathname} has unexpected shape; expected { fields, rows }.`,
    );
  }
  return data as BlobTable;
}
