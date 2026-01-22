# Koltin Quote API

Backend del formulario de cotización usando Next.js 14 App Router (Route Handlers).

## Requisitos

- Node.js 18+
- Credenciales de HubSpot y Supabase

## Variables de entorno

Crea un archivo `.env.local` con:

```
HUBSPOT_ACCESS_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ALLOWED_ORIGINS=https://v0-build-koltin-form.vercel.app,https://v0-build-koltin-form-nab6nq577-shemantyk.vercel.app,http://localhost:3000
```

`ALLOWED_ORIGINS` es opcional. Si no se define, el API permite cualquier origen y refleja el `Origin` (o `*` si no hay origin). En Vercel, asegúrate de incluir los dominios del front (preview y production).

Si agregas `NEXT_PUBLIC_FORMS_API_BASE_URL` en el front, haz redeploy (o un push a main) para que el build tome la nueva variable.

## Ejecutar en local

```
npm install
npm run dev
```

## Endpoint

`POST /api/quote`

El payload de ejemplo está en `src/examples/quote_payload.json`.

### Enums esperados (values exactos)

Estos valores deben coincidir con las opciones configuradas en HubSpot:

- `paraQuien`: `myself` | `family` | `Group of people` | `couple`
- `paymentPlan`: `yearly` | `monthly` | `i need to evaluate` | `out of budget` | `just monthly` | `quarterly or semi-annual`
- `hasInsurance`: `Yes` | `No`
- `paymentMethod`: `credit` | `debit` | `bank transfer` | `cash`
- `benefitInterest`: `insurance` | `preventive health` | `community`
- `coverageStart`: `now` | `this month` | `1 - 2 months` | `3 - 6 months` | `in a few months` | `undecided`

Los enums se validan contra `schemas/hs_contact_enums.json`.

### Ejemplo con curl

```
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d @src/examples/quote_payload.json
```

### Respuesta

```
{
  "ok": true,
  "quote_id": "uuid",
  "hubspot_contact_id": "12345",
  "derived": {
    "effectiveAge": 52,
    "ageBandTitular": "50 - 54",
    "ageBandPareja": "50 - 54",
    "quote": 1798
  }
}
```

## Notas

- El backend recalcula `effectiveAge` y `ageBand` en base a `dobTitular` y `dobPareja`.
- Se guardan `answers`, `normalized`, `derived` y trazas de HubSpot en Supabase.
- Si falla HubSpot, el error se registra en Supabase y la respuesta es 502.
