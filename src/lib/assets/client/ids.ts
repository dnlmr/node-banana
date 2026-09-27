/**
 * Client-minted ids for assets and runs. Minting on the client lets an
 * executor put the asset id into node data together with the output, so
 * nothing has to be written back after the upload finishes.
 */

function randomBase36(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += (byte % 36).toString(36);
  return out;
}

function mint(prefix: "a" | "r", now: number): string {
  return `${prefix}${now.toString(36)}${randomBase36(10)}`;
}

/** Matches ASSET_ID_PATTERN. Time-sortable. */
export function newAssetId(now: number = Date.now()): string {
  return mint("a", now);
}

/** Matches RUN_ID_PATTERN. */
export function newRunId(now: number = Date.now()): string {
  return mint("r", now);
}
