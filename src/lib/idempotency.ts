import { createHash } from "crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildIdempotencyKey(
  email: string,
  schemaVersion: string,
  date: string
): string {
  return sha256(`${email}|${schemaVersion}|${date}`);
}
