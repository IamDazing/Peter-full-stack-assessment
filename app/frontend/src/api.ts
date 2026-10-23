import { z } from "zod";
import {
  addResultSchema,
  cartSchema,
  productSchema,
  type AddPayload,
} from "./domain";

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(body);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new ApiError(response.status, code, message, details);
      }
      throw new ApiError(
        response.status,
        "HTTP_ERROR",
        "The service could not complete this request.",
      );
    }
    return schema.parse(body);
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  product: () => request("/api/products/everyday-tee", productSchema),
  cart: () => request("/api/cart", cartSchema),
  add: (body: AddPayload, key: string) =>
    request("/api/cart/items", addResultSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
};
