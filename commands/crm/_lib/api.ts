import { http } from '@hubspot/local-dev-lib/http';
import * as z from 'zod';
import { CRM_API_BASE } from './constants.js';

// Generic GET with Zod validation
export async function crmGet<T>(
  accountId: number,
  path: string,
  schema: z.ZodType<T>,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const cleanParams: Record<string, string> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) cleanParams[k] = String(v);
    }
  }
  const response = await http.get(accountId, {
    url: `${CRM_API_BASE}${path}`,
    params: cleanParams,
  });
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`API response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Generic POST with Zod validation
export async function crmPost<T>(
  accountId: number,
  path: string,
  schema: z.ZodType<T>,
  data?: unknown,
  params?: Record<string, string>
): Promise<T> {
  const response = await http.post(accountId, {
    url: `${CRM_API_BASE}${path}`,
    data: data as Record<string, unknown>,
    params,
  });
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`API response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Generic PATCH
export async function crmPatch<T>(
  accountId: number,
  path: string,
  schema: z.ZodType<T>,
  data: unknown
): Promise<T> {
  const response = await http.patch(accountId, {
    url: `${CRM_API_BASE}${path}`,
    data: data as Record<string, unknown>,
  });
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`API response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Generic DELETE (returns void usually)
export async function crmDelete(
  accountId: number,
  path: string
): Promise<void> {
  await http.delete(accountId, {
    url: `${CRM_API_BASE}${path}`,
  });
}
