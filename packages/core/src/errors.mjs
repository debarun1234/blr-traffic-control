/** HTTP-mappable error used across core and the API. Codes match docs/api-contract.md. */
export const STATUS = Object.freeze({ unauthenticated: 401, forbidden: 403, not_found: 404, invalid: 400, conflict: 409, rate_limited: 429, quota_exceeded: 429, unavailable: 503 });
export class ApiError extends Error {
  /** @param {keyof typeof STATUS} code */
  constructor(code, message, extra) {
    super(message ?? code);
    this.code = code; this.status = STATUS[code] ?? 500; this.extra = extra;
  }
}
export const err = (code, message, extra) => new ApiError(code, message, extra);
