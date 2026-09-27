/**
 * AssetPageRequest <-> URL query string, shared by the client and the
 * GET /api/assets route so both sides agree on the wire format.
 *
 * Repeated keys carry lists: `kind=image&kind=video`. Booleans are "1"/"0".
 */

import {
  ASSET_KINDS,
  ASSET_ORIGINS,
  type AssetKind,
  type AssetOrigin,
  type AssetPageRequest,
  type AssetQuery,
  type AssetScope,
  type AssetSort,
} from "./types";

const LIST_KEYS = {
  kinds: "kind",
  origins: "origin",
  tags: "tag",
  models: "model",
  workflowIds: "workflow",
  projects: "project",
} as const;

export const DEFAULT_PAGE_LIMIT = 200;
export const MAX_PAGE_LIMIT = 500;

export function encodeAssetPageRequest(request: AssetPageRequest): URLSearchParams {
  const params = new URLSearchParams();
  if (request.scope && request.scope !== "library") params.set("scope", request.scope);
  if (request.q) params.set("q", request.q);
  for (const [field, key] of Object.entries(LIST_KEYS) as [keyof typeof LIST_KEYS, string][]) {
    for (const value of request[field] ?? []) params.append(key, value);
  }
  if (request.favorite !== undefined) params.set("favorite", request.favorite ? "1" : "0");
  if (request.from !== undefined) params.set("from", String(request.from));
  if (request.to !== undefined) params.set("to", String(request.to));
  if (request.sort && request.sort !== "newest") params.set("sort", request.sort);
  if (request.cursor) params.set("cursor", request.cursor);
  if (request.newerThan) params.set("newerThan", request.newerThan);
  if (request.limit !== undefined) params.set("limit", String(request.limit));
  return params;
}

function finite(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function decodeAssetPageRequest(params: URLSearchParams): AssetPageRequest {
  const request: AssetPageRequest = {};
  const scope = params.get("scope");
  if (scope === "trash" || scope === "missing" || scope === "library") request.scope = scope as AssetScope;
  const q = params.get("q");
  if (q) request.q = q.slice(0, 200);

  const kinds = params.getAll(LIST_KEYS.kinds).filter((k): k is AssetKind => (ASSET_KINDS as readonly string[]).includes(k));
  if (kinds.length) request.kinds = kinds;
  const origins = params.getAll(LIST_KEYS.origins).filter((o): o is AssetOrigin => (ASSET_ORIGINS as readonly string[]).includes(o));
  if (origins.length) request.origins = origins;
  for (const field of ["tags", "models", "workflowIds", "projects"] as const) {
    const values = params.getAll(LIST_KEYS[field]).map((v) => v.slice(0, 1024));
    if (values.length) request[field] = values;
  }

  const favorite = params.get("favorite");
  if (favorite === "1" || favorite === "0") request.favorite = favorite === "1";
  request.from = finite(params.get("from"));
  request.to = finite(params.get("to"));
  if (request.from === undefined) delete request.from;
  if (request.to === undefined) delete request.to;
  const sort = params.get("sort");
  if (sort === "oldest" || sort === "newest") request.sort = sort as AssetSort;
  const cursor = params.get("cursor");
  if (cursor) request.cursor = cursor;
  const newerThan = params.get("newerThan");
  if (newerThan) request.newerThan = newerThan;
  const limit = finite(params.get("limit"));
  if (limit !== undefined) request.limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(limit)));
  return request;
}

/** The filter part of a page request (drops paging fields), e.g. for "select all matching". */
export function queryOf(request: AssetPageRequest): AssetQuery {
  const { cursor: _cursor, newerThan: _newerThan, limit: _limit, ...query } = request;
  return query;
}

/** True when two queries select the same set (paging fields ignored). */
export function sameQuery(a: AssetQuery, b: AssetQuery): boolean {
  return encodeAssetPageRequest(queryOf(a)).toString() === encodeAssetPageRequest(queryOf(b)).toString();
}
