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
ALLOWED_ORIGINS=https://koltin.mx,https://www.koltin.mx
```

`ALLOWED_ORIGINS` es opcional. Si no se define, no se aplican restricciones CORS en el servidor (documentado por seguridad).

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

- `paraQuien`: `solo_titular` | `titular_y_pareja` | `grupo`
- `paymentPlan`: `monthly` | `annual`
- `hasInsurance`: `yes` | `no`
- `paymentMethod`: `card` | `transfer` | `cash` | `other`
- `benefitInterest`: `consultas` | `medicamentos` | `hospitalizacion` | `otro`
- `coverageStart`: `inmediato` | `1_3_meses` | `3_6_meses` | `mas_6_meses`
- `discoverySource`: `facebook` | `google` | `referido` | `otro`

Si los valores reales en HubSpot son diferentes, actualiza los enums en
`src/app/api/quote/route.ts`.

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
