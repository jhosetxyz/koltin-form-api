import { NextResponse } from "next/server";
import { z } from "zod";

import hubspotEnums from "../../../../schemas/hs_contact_enums.json";
import { effectiveAgeBand } from "@/lib/age";
import { env } from "@/lib/env";
import { createContact, searchContactByEmail, updateContact } from "@/lib/hubspot";
import { buildIdempotencyKey } from "@/lib/idempotency";
import { getQuoteByBand, PaymentPlan } from "@/lib/pricing";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

type HubspotEnumOption = { label: string; value: string };
type HubspotEnum = {
  name: string;
  label?: string;
  fieldType?: string;
  options?: HubspotEnumOption[];
};

const hubspotEnumMap = new Map<string, string[]>(
  (hubspotEnums.enums as HubspotEnum[]).map((entry) => [
    entry.name,
    (entry.options ?? []).map((option) => option.value),
  ])
);

const HUBSPOT_ENUMS = {
  paraQuien: hubspotEnumMap.get("para_quien_es_la_membresia__form") ?? [],
  paymentPlan: hubspotEnumMap.get("payment_plan__form") ?? [],
  hasInsurance: hubspotEnumMap.get("has_health_insurance__form") ?? [],
  paymentMethod: hubspotEnumMap.get("metodo_de_pago") ?? [],
  benefitInterest: hubspotEnumMap.get("beneficio_de_interes") ?? [],
  coverageStart: hubspotEnumMap.get("preferred_coverage_start__form") ?? [],
  ageBandTitular: hubspotEnumMap.get("cual_es_tu_edad__form") ?? [],
  ageBandPareja:
    hubspotEnumMap.get("cual_es_es_la_edad_del_segundo_cotizando_") ?? [],
  wantsCall: hubspotEnumMap.get("agendocalendario") ?? [],
};

const DISCOVERY_SOURCE = ["facebook", "google", "referido", "otro"] as const;

const requestSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  paraQuien: z.string(),
  dobTitular: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dobPareja: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentPlan: z.string(),
  hasInsurance: z.string(),
  paymentMethod: z.string().optional(),
  benefitInterest: z.string().optional(),
  coverageStart: z.string().optional(),
  discoverySource: z.enum(DISCOVERY_SOURCE).optional(),
  wantsCall: z.boolean().optional(),
  insurerName: z.string().optional(),
  insuranceExpiry: z.string().optional(),
  groupSize: z.number().int().positive().optional(),
  groupAgesText: z.string().optional(),
  pageUrl: z.string().url().optional(),
  referrer: z.string().url().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmTerm: z.string().optional(),
  utmContent: z.string().optional(),
  gclid: z.string().optional(),
  fbclid: z.string().optional(),
});

type RequestPayload = z.infer<typeof requestSchema>;

type StoredSubmission = {
  id: string;
  hubspot_contact_id: string | null;
  derived: {
    effectiveAge: number;
    ageBandTitular: string;
    ageBandPareja?: string | null;
    quote: number | null;
  };
};

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "invalid-email";
  const maskedLocal =
    local.length <= 2
      ? `${local[0] ?? ""}***`
      : `${local.slice(0, 1)}***${local.slice(-1)}`;
  const domainParts = domain.split(".");
  const maskedDomain = `${domainParts[0]?.[0] ?? ""}***.${
    domainParts.slice(1).join(".") || "com"
  }`;
  return `${maskedLocal}@${maskedDomain}`;
}

function maskPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 2) return "***";
  return `***${digits.slice(-2)}`;
}

function normalizePhone(phone?: string): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const normalized = trimmed.replace(/[\s()-]/g, "");
  if (normalized.startsWith("00")) {
    return `+${normalized.slice(2)}`;
  }
  return normalized;
}

function parseDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00Z`);
}

function normalizeAliasKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInput(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const ALIASES = {
  paraQuien: new Map<string, string>([
    ["para mi y mi pareja", "couple"],
    ["para un grupo", "Group of people"],
  ]),
  coverageStart: new Map<string, string>([
    ["en este mes", "now"],
    ["aun no lo decidimos", "undecided"],
  ]),
  hasInsurance: new Map<string, string>([
    ["si", "Yes"],
    ["no", "No"],
  ]),
};

function applyAlias(
  value: string | null,
  aliases?: Map<string, string>
): string | null {
  if (!value) return null;
  if (!aliases) return value;
  const key = normalizeAliasKey(value);
  return aliases.get(key) ?? value;
}

function mapPaymentPlanToPricing(value: string | null): PaymentPlan | null {
  if (!value) return null;
  return value === "yearly" ? "annual" : "monthly";
}

function collectInvalidEnum(
  field: string,
  value: string | null,
  allowed: string[],
  required: boolean,
  invalid: Array<{ field: string; value: string | null; allowed: string[] }>
) {
  if (!value) {
    if (required) {
      invalid.push({ field, value, allowed });
    }
    return;
  }
  if (!allowed.includes(value)) {
    invalid.push({ field, value, allowed });
  }
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowAnyOrigin = env.ALLOWED_ORIGINS.length === 0;
  const originAllowed = origin ? env.ALLOWED_ORIGINS.includes(origin) : false;

  if (!allowAnyOrigin && !originAllowed) {
    return {};
  }

  const allowOrigin = origin ?? "*";

  return {
    "Access-Control-Allow-Origin": allowAnyOrigin ? allowOrigin : origin!,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Request-Id, Idempotency-Key",
    "Access-Control-Max-Age": "86400",
    ...(origin ? { Vary: "Origin" } : {}),
  };
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchExistingSubmission(
  idempotencyKey: string
): Promise<StoredSubmission | null> {
  const { data, error } = await supabaseAdmin
    .from("form_submissions")
    .select("id, hubspot_contact_id, derived")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase select error: ${error.message}`);
  }

  return data as StoredSubmission | null;
}

async function insertSubmission(payload: {
  schema_version: string;
  page_url?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  answers: RequestPayload;
  normalized: Record<string, unknown>;
  derived: StoredSubmission["derived"];
  status: "received" | "hubspot_ok" | "hubspot_error";
  hubspot_contact_id?: string | null;
  hubspot_payload?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  request_id: string;
  idempotency_key: string;
}): Promise<{ submission: StoredSubmission; reused: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("form_submissions")
    .insert(payload)
    .select("id, hubspot_contact_id, derived")
    .single();

  if (error) {
    if (error.code === "23505") {
      const existing = await fetchExistingSubmission(payload.idempotency_key);
      if (existing) {
        return { submission: existing, reused: true };
      }
    }
    throw new Error(`Supabase insert error: ${error.message}`);
  }

  return { submission: data as StoredSubmission, reused: false };
}

async function updateSubmission(
  id: string,
  payload: Partial<{
    status: "hubspot_ok" | "hubspot_error";
    hubspot_contact_id: string | null;
    hubspot_payload: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
  }>
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("form_submissions")
    .update(payload)
    .eq("id", id);

  if (error) {
    throw new Error(`Supabase update error: ${error.message}`);
  }
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const headers = getCorsHeaders(origin);
  if (env.ALLOWED_ORIGINS.length > 0 && origin && !headers["Access-Control-Allow-Origin"]) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (env.ALLOWED_ORIGINS.length > 0 && origin && !corsHeaders["Access-Control-Allow-Origin"]) {
    return NextResponse.json(
      { ok: false, error: "origin_not_allowed", request_id: requestId },
      { status: 403 }
    );
  }

  let payload: RequestPayload;
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten(), request_id: requestId },
        { status: 400, headers: corsHeaders }
      );
    }
    payload = parsed.data;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "invalid_json", request_id: requestId },
      { status: 400, headers: corsHeaders }
    );
  }

  const masked = {
    email: maskEmail(payload.email),
    phone: maskPhone(payload.phone),
  };
  // eslint-disable-next-line no-console
  console.log("quote_request_received", { request_id: requestId, ...masked });

  const schemaVersion = "v1";
  const idempotencyKey = buildIdempotencyKey(
    payload.email.toLowerCase(),
    schemaVersion,
    getTodayIsoDate()
  );

  try {
    const existing = await fetchExistingSubmission(idempotencyKey);
    if (existing) {
      return NextResponse.json(
        {
          ok: true,
          quote_id: existing.id,
          hubspot_contact_id: existing.hubspot_contact_id,
          derived: existing.derived,
        },
        { status: 200, headers: corsHeaders }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "database_error", request_id: requestId },
      { status: 500, headers: corsHeaders }
    );
  }

  const titularDob = parseDate(payload.dobTitular);
  const titularDerived = effectiveAgeBand(titularDob);
  const parejaDerived = payload.dobPareja
    ? effectiveAgeBand(parseDate(payload.dobPareja))
    : null;

  const normalized = {
    email: payload.email.trim().toLowerCase(),
    phone: normalizePhone(payload.phone),
    paraQuien: applyAlias(normalizeInput(payload.paraQuien), ALIASES.paraQuien),
    ageBandTitular: titularDerived.band,
    ageBandPareja: parejaDerived?.band ?? null,
    paymentPlan: normalizeInput(payload.paymentPlan),
    hasInsurance: applyAlias(
      normalizeInput(payload.hasInsurance),
      ALIASES.hasInsurance
    ),
    paymentMethod: normalizeInput(payload.paymentMethod),
    benefitInterest: normalizeInput(payload.benefitInterest),
    coverageStart: applyAlias(
      normalizeInput(payload.coverageStart),
      ALIASES.coverageStart
    ),
    discoverySource: payload.discoverySource ?? null,
    wantsCall: payload.wantsCall ?? null,
    insurerName: payload.insurerName ?? null,
    insuranceExpiry: payload.insuranceExpiry ?? null,
    groupSize: payload.groupSize ?? null,
    groupAgesText: payload.groupAgesText ?? null,
  };

  const normalizedWantsCall =
    normalized.wantsCall === null ? null : normalized.wantsCall ? "true" : "false";
  const paymentPlanIsValid =
    normalized.paymentPlan !== null &&
    HUBSPOT_ENUMS.paymentPlan.includes(normalized.paymentPlan);
  const pricingPlan = paymentPlanIsValid
    ? mapPaymentPlanToPricing(normalized.paymentPlan)
    : null;
  const titularQuote =
    pricingPlan === null
      ? null
      : getQuoteByBand(titularDerived.band, pricingPlan);
  const parejaQuote =
    pricingPlan === null || !parejaDerived
      ? null
      : getQuoteByBand(parejaDerived.band, pricingPlan);
  const quote =
    pricingPlan === null ||
    titularQuote === null ||
    (parejaDerived && parejaQuote === null)
      ? null
      : titularQuote + (parejaQuote ?? 0);

  const derived = {
    effectiveAge: titularDerived.effectiveAge,
    ageBandTitular: titularDerived.band,
    ageBandPareja: parejaDerived?.band ?? null,
    quote,
  };

  const hubspotProperties: Record<string, string | null> = {
    email: normalized.email,
    phone: normalized.phone,
    para_quien_es_la_membresia__form: normalized.paraQuien,
    cual_es_tu_edad__form: normalized.ageBandTitular,
    cual_es_es_la_edad_del_segundo_cotizando_: normalized.ageBandPareja,
    payment_plan__form: normalized.paymentPlan,
    has_health_insurance__form: normalized.hasInsurance,
    metodo_de_pago: normalized.paymentMethod,
    beneficio_de_interes: normalized.benefitInterest,
    preferred_coverage_start__form: normalized.coverageStart,
    agendocalendario: normalizedWantsCall,
  };

  const invalidEnums: Array<{
    field: string;
    value: string | null;
    allowed: string[];
  }> = [];
  collectInvalidEnum(
    "paraQuien",
    normalized.paraQuien,
    HUBSPOT_ENUMS.paraQuien,
    true,
    invalidEnums
  );
  collectInvalidEnum(
    "paymentPlan",
    normalized.paymentPlan,
    HUBSPOT_ENUMS.paymentPlan,
    true,
    invalidEnums
  );
  collectInvalidEnum(
    "hasInsurance",
    normalized.hasInsurance,
    HUBSPOT_ENUMS.hasInsurance,
    true,
    invalidEnums
  );
  collectInvalidEnum(
    "paymentMethod",
    normalized.paymentMethod,
    HUBSPOT_ENUMS.paymentMethod,
    false,
    invalidEnums
  );
  collectInvalidEnum(
    "benefitInterest",
    normalized.benefitInterest,
    HUBSPOT_ENUMS.benefitInterest,
    false,
    invalidEnums
  );
  collectInvalidEnum(
    "coverageStart",
    normalized.coverageStart,
    HUBSPOT_ENUMS.coverageStart,
    false,
    invalidEnums
  );
  collectInvalidEnum(
    "ageBandTitular",
    normalized.ageBandTitular,
    HUBSPOT_ENUMS.ageBandTitular,
    true,
    invalidEnums
  );
  collectInvalidEnum(
    "ageBandPareja",
    normalized.ageBandPareja,
    HUBSPOT_ENUMS.ageBandPareja,
    false,
    invalidEnums
  );
  collectInvalidEnum(
    "wantsCall",
    normalizedWantsCall,
    HUBSPOT_ENUMS.wantsCall,
    false,
    invalidEnums
  );

  let submission: StoredSubmission;
  let reusedSubmission = false;
  try {
    const insertResult = await insertSubmission({
      schema_version: schemaVersion,
      page_url: payload.pageUrl,
      referrer: payload.referrer,
      utm_source: payload.utmSource,
      utm_medium: payload.utmMedium,
      utm_campaign: payload.utmCampaign,
      utm_term: payload.utmTerm,
      utm_content: payload.utmContent,
      gclid: payload.gclid,
      fbclid: payload.fbclid,
      answers: payload,
      normalized,
      derived,
      status: invalidEnums.length > 0 ? "hubspot_error" : "received",
      hubspot_payload: hubspotProperties,
      error: invalidEnums.length > 0 ? { invalid_enums: invalidEnums } : null,
      request_id: requestId,
      idempotency_key: idempotencyKey,
    });
    submission = insertResult.submission;
    reusedSubmission = insertResult.reused;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "database_error", request_id: requestId },
      { status: 500, headers: corsHeaders }
    );
  }

  if (reusedSubmission) {
    return NextResponse.json(
      {
        ok: true,
        quote_id: submission.id,
        hubspot_contact_id: submission.hubspot_contact_id,
        derived: submission.derived,
      },
      { status: 200, headers: corsHeaders }
    );
  }

  if (invalidEnums.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_enum",
          details: invalidEnums,
        },
        request_id: requestId,
      },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const existingContact = await searchContactByEmail(normalized.email);
    const contact = existingContact
      ? await updateContact(existingContact.id, hubspotProperties)
      : await createContact(hubspotProperties);

    await updateSubmission(submission.id, {
      status: "hubspot_ok",
      hubspot_contact_id: contact.id,
      hubspot_payload: hubspotProperties,
      error: null,
    });

    return NextResponse.json(
      {
        ok: true,
        quote_id: submission.id,
        hubspot_contact_id: contact.id,
        derived,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const errorPayload = {
      message: error instanceof Error ? error.message : "unknown_error",
    };
    try {
      await updateSubmission(submission.id, {
        status: "hubspot_error",
        hubspot_payload: hubspotProperties,
        error: errorPayload,
      });
    } catch (updateError) {
      // eslint-disable-next-line no-console
      console.error("hubspot_error_update_failed", {
        request_id: requestId,
        error: updateError instanceof Error ? updateError.message : "unknown",
      });
    }

    return NextResponse.json(
      { ok: false, error: "hubspot_error", request_id: requestId },
      { status: 502, headers: corsHeaders }
    );
  }
}
