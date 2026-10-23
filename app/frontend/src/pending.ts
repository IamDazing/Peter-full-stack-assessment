import { z } from "zod";

const storageKey = "fieldwork.pending-add.v1";
const pendingSchema = z.object({
  key: z.string().min(1),
  body: z.object({ sku_id: z.string(), quantity: z.number().int().positive() }),
});
export type Pending = z.infer<typeof pendingSchema>;

export function readPending(): Pending | null {
  try {
    const parsed = pendingSchema.safeParse(
      JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function savePending(value: Pending | null): boolean {
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
