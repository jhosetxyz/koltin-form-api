import { z } from "zod";

const envSchema = z.object({
  HUBSPOT_ACCESS_TOKEN: z.string().min(1, "HUBSPOT_ACCESS_TOKEN requerido"),
  SUPABASE_URL: z.string().url("SUPABASE_URL invalida"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY requerido"),
  ALLOWED_ORIGINS: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  // eslint-disable-next-line no-console
  console.error("Invalid env vars", errors);
  throw new Error("Invalid environment variables");
}

const allowedOrigins = parsed.data.ALLOWED_ORIGINS
  ? parsed.data.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : [];

export const env = {
  ...parsed.data,
  ALLOWED_ORIGINS: allowedOrigins,
};
