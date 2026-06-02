# Alive WhatsApp API

Production-oriented Node.js + Express API for sending WhatsApp messages through ChakraHQ, with template creation, template metadata storage, and image header template sending.

This project is no longer just a tiny "frontend/backend" wrapper. The production version has several moving parts:

- Express API routes for health checks, session messages, template creation, template listing, and template sending
- ChakraHQ integration for WhatsApp session messages and approved WhatsApp template messages
- Supabase storage for template metadata, named variable mapping, examples, headers, and Chakra responses
- API key authentication for all write/read business endpoints
- API usage logging, rate limits, daily caps, and duplicate-send protection
- Vercel deployment using the same Express app through `api/index.js`
- Tests for image header template creation and image header template sending payloads

## Current Production Baseline

The current production baseline is `main`. The `image-header-template` branch is kept aligned with `main` while image-header work is active. This is the version that supports:

- creating WhatsApp templates with no header
- creating WhatsApp templates with a text header
- creating WhatsApp templates with an image header
- sending templates to phone numbers using named variables
- requiring `image_url` only when the stored template has an image header
- converting API-friendly `image_url` into ChakraHQ's `imageUrl` field
- blocking accidental duplicate sends with `idempotency_key`
- enforcing simple per-minute, per-day, and template-create limits

## Files

- `app.js` - shared Express app used by local server and Vercel
- `server.js` - local Node.js entry point for `npm start`
- `api/index.js` - Vercel function entry
- `routes/sendMessage.js` - generic session message and raw template send endpoint
- `services/chakraService.js` - ChakraHQ message sending logic
- `src/routes/templates.js` - create/list template endpoints
- `src/routes/sendTemplate.js` - production-friendly named-variable template sending endpoint
- `src/services/chakraTemplateService.js` - ChakraHQ template management logic
- `src/services/templateMappingService.js` - named placeholder to positional mapping logic
- `src/services/apiUsageService.js` - usage logging, rate-limit, and duplicate-send helpers
- `src/config/supabase.js` - Supabase service client setup
- `src/middleware/auth.js` - API key validation
- `supabase/schema.sql` - required Supabase table and trigger
- `test/imageHeader.test.js` - image header create/send coverage
- `.env.example` - required environment variable reference
- `vercel.json` - rewrites all routes to the Vercel function

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Start locally:

```bash
npm start
```

The API runs on `http://localhost:3000` by default.

Run tests:

```bash
npm test
```

## Environment Variables

Put these values into local `.env` and into Vercel production environment variables.

```env
PORT=3000
CLIENT_API_KEY=replace_with_my_client_api_key

# ChakraHQ - reused by /send-message and template endpoints
CHAKRA_ACCESS_TOKEN=replace_with_chakra_access_token
CHAKRA_PLUGIN_ID=replace_with_plugin_id
CHAKRA_WA_API_VERSION=v22.0
CHAKRA_PHONE_NUMBER_ID=replace_with_phone_number_id

# ChakraHQ - template management
CHAKRA_API_BASE_URL=https://api.chakrahq.com
CHAKRA_TEST_WABA_ID=replace_with_test_waba_id

# Supabase
SUPABASE_URL=replace_with_supabase_url
SUPABASE_SERVICE_ROLE_KEY=replace_with_supabase_service_role_key

# API protection
CLIENT_API_LABEL=client_main
SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE=60
SEND_TEMPLATE_DAILY_LIMIT=1000
TEMPLATE_CREATE_RATE_LIMIT_PER_HOUR=10
DUPLICATE_WINDOW_MINUTES=10
```

Important details:

- `CLIENT_API_KEY` is required for every business endpoint.
- `/templates` and `/send-template` expect the key in the `X-API-Key` header.
- `/send-message` is the legacy endpoint and expects `api_key` in the JSON body.
- `CHAKRA_ACCESS_TOKEN`, `CHAKRA_PLUGIN_ID`, and `CHAKRA_PHONE_NUMBER_ID` are required for sending.
- `CHAKRA_WA_API_VERSION` is required for non-template session messages.
- `CHAKRA_TEST_WABA_ID` is required for creating and listing templates.
- `SUPABASE_SERVICE_ROLE_KEY` is used server-side only. Never expose it to a browser or client app.
- Values starting with `replace_with_` are treated as not configured.
- `CLIENT_API_LABEL` is written to usage logs so you can identify the customer/API key later.
- `SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE` protects ChakraHQ, Vercel, and Supabase from sudden spikes.
- `SEND_TEMPLATE_DAILY_LIMIT` is the daily sending cap for this API key label.
- `TEMPLATE_CREATE_RATE_LIMIT_PER_HOUR` keeps template creation low-frequency.
- `DUPLICATE_WINDOW_MINUTES` controls fallback duplicate protection when no `idempotency_key` is provided.

## Supabase Setup

Run `supabase/schema.sql` once in the Supabase SQL editor.

The API stores template metadata in `whatsapp_templates`:

- `template_name`
- `category`
- `language`
- `status`
- `body_original`
- `body_meta`
- `header`
- `variables_order`
- `mapping`
- `examples`
- `chakra_template_id`
- `raw_request`
- `raw_chakra_response`

The API also stores request and protection data in `api_usage_logs`:

- `request_id`
- `endpoint`
- `api_key_label`
- `phone`
- `phone_last4`
- `template_name`
- `language`
- `idempotency_key`
- `request_hash`
- `image_url_present`
- `variables_keys`
- `status`
- `error_message`
- `metadata`
- `created_at`

Why Supabase is needed:

- Meta/Chakra templates use positional variables like `{{1}}`, `{{2}}`.
- Humans and product code prefer named variables like `{{student_name}}`.
- The API stores the mapping once during `POST /templates`.
- Later, `POST /send-template` can accept readable named variables and convert them safely.
- The API uses logs to enforce rate limits, daily caps, and duplicate-send protection.

## Endpoints

### GET /health

```bash
curl http://localhost:3000/health
```

Example response:

```json
{
  "success": true,
  "service": "Alive WhatsApp Template API",
  "status": "ok"
}
```

### POST /templates

Creates a WhatsApp template in ChakraHQ and stores template metadata in Supabase.

Use this for new reusable templates, including image header templates.

Supported categories:

- `MARKETING`
- `UTILITY`

Supported languages:

- `en`
- `zh_CN`

Supported headers:

- no header
- text header
- image header

Current limitations:

- footer is not supported
- buttons are not supported
- text header variables are not supported
- image header requires a public `https` `example_url`
- template names must use lowercase letters, digits, and underscores only

Create a template with image header:

```bash
curl -X POST http://localhost:3000/templates \
  -H "X-API-Key: my_client_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "template_name": "course_promo_image_v1",
    "category": "MARKETING",
    "language": "en",
    "header": {
      "type": "IMAGE",
      "example_url": "https://example.com/template-sample.jpg"
    },
    "body": "Hi {{student_name}}, your class {{course_name}} is open for registration.",
    "variables": ["student_name", "course_name"],
    "examples": {
      "student_name": "John",
      "course_name": "Art Therapy Workshop"
    }
  }'
```

What the API does:

- validates the API key
- validates the template name, category, language, body, variables, examples, and header
- converts the body from named placeholders to Meta-style positional placeholders
- sends the create-template request to ChakraHQ
- stores the named-to-positional mapping in Supabase
- stores Chakra's raw response for later debugging

Example conversion:

```text
Input body:
Hi {{student_name}}, your class {{course_name}} is open for registration.

Sent to ChakraHQ:
Hi {{1}}, your class {{2}} is open for registration.

Stored mapping:
{
  "1": "student_name",
  "2": "course_name"
}
```

Example success response:

```json
{
  "success": true,
  "template_name": "course_promo_image_v1",
  "language": "en",
  "status": "PENDING",
  "chakra_template_id": "1234567890"
}
```

### GET /templates

Lists templates from ChakraHQ and merges them with metadata stored in Supabase.

```bash
curl http://localhost:3000/templates \
  -H "X-API-Key: my_client_api_key"
```

Example response shape:

```json
{
  "success": true,
  "templates": [
    {
      "template_name": "course_promo_image_v1",
      "category": "MARKETING",
      "language": "en",
      "status": "APPROVED",
      "header": {
        "type": "IMAGE",
        "example_url": "https://example.com/template-sample.jpg"
      },
      "body_meta": "Hi {{1}}, your class {{2}} is open for registration.",
      "body_original": "Hi {{student_name}}, your class {{course_name}} is open for registration.",
      "variables_order": ["student_name", "course_name"],
      "mapping": {
        "1": "student_name",
        "2": "course_name"
      },
      "examples": {
        "student_name": "John",
        "course_name": "Art Therapy Workshop"
      },
      "chakra_template_id": "1234567890",
      "channel": "test"
    }
  ]
}
```

### POST /send-template

Sends a stored template to a WhatsApp number using named variables.

This is the preferred production endpoint for templates because the caller does not need to remember Meta's positional variable order.

Send an image header template:

```bash
curl -X POST http://localhost:3000/send-template \
  -H "X-API-Key: my_client_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "booking_BO-Dl1It0_confirmation_v1",
    "phone": "60123456789",
    "template_name": "course_promo_image_v1",
    "language": "en",
    "image_url": "https://example.com/live-banner.jpg",
    "variables": {
      "student_name": "Peter",
      "course_name": "Art Therapy Workshop"
    }
  }'
```

What the API does:

- validates the API key
- checks the per-minute rate limit
- checks the daily sending cap
- blocks duplicate sends by `idempotency_key`
- if no `idempotency_key` is provided, blocks identical `phone + template + variables + image_url` requests inside the duplicate window
- normalizes the phone number by removing spaces, dashes, and `+`
- loads the template metadata from Supabase
- checks whether the stored template has an image header
- requires `image_url` only for image header templates
- validates that `image_url` is a public `https` URL
- converts named variables into ChakraHQ positional mapping
- sends the template through ChakraHQ
- writes a usage log with `sent`, `failed`, or `blocked` status

For the example above, the API sends ChakraHQ this mapping:

```json
[
  {
    "schema_property_name": "1",
    "schema_property_value": "Peter"
  },
  {
    "schema_property_name": "2",
    "schema_property_value": "Art Therapy Workshop"
  }
]
```

And for image headers it includes:

```json
{
  "image_url": "https://example.com/live-banner.jpg"
}
```

`services/chakraService.js` then maps this to ChakraHQ's expected field:

```json
{
  "imageUrl": "https://example.com/live-banner.jpg"
}
```

Example success response:

```json
{
  "success": true,
  "template_name": "course_promo_image_v1",
  "language": "en",
  "phone": "60123456789"
}
```

Duplicate-send response:

```json
{
  "success": false,
  "error": "Duplicate send blocked.",
  "previous_request_id": "tpl_send_1780000000000_abc123"
}
```

Rate-limit response:

```json
{
  "success": false,
  "error": "Rate limit exceeded. Please retry later.",
  "retry_after_seconds": 60
}
```

### POST /send-message

Lower-level endpoint for direct message sending. It supports:

- `text`
- `image`
- `template`

Use `text` and `image` only for WhatsApp session messages, where the customer has messaged the business number within the active 24-hour window.

For outbound notifications, use approved WhatsApp templates.

Text message:

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "my_client_api_key",
    "phone": "60123456789",
    "message_type": "text",
    "payload": {
      "text": "Hi, your booking is confirmed"
    }
  }'
```

Image session message:

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "my_client_api_key",
    "phone": "60123456789",
    "message_type": "image",
    "payload": {
      "image_url": "https://example.com/image.jpg",
      "caption": "Your booking receipt"
    }
  }'
```

Raw template send:

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "my_client_api_key",
    "phone": "60123456789",
    "message_type": "template",
    "payload": {
      "template_name": "course_promo_image_v1",
      "language": "en",
      "mapping": [
        {
          "schema_property_name": "1",
          "schema_property_value": "Peter"
        }
      ],
      "header_mapping": [],
      "button_mapping": [],
      "image_url": "https://example.com/live-banner.jpg"
    }
  }'
```

Use `/send-message` for raw control. Use `/send-template` for product-facing calls.

## Image Header Template Rules

Create-time image header:

```json
{
  "header": {
    "type": "IMAGE",
    "example_url": "https://example.com/template-sample.jpg"
  }
}
```

Send-time image header:

```json
{
  "image_url": "https://example.com/live-banner.jpg"
}
```

Rules:

- both URLs must be public `https`
- `example_url` is for template creation and review
- `image_url` is the real image sent to the recipient
- `header.text` is rejected when `header.type` is `IMAGE`
- `image_url` is required only when the stored template header is `IMAGE`
- `image_url` is ignored for text-header or no-header templates by `/send-template`

## Production Checklist

Before treating the API as production-ready, confirm these layers:

- API key auth: `CLIENT_API_KEY` is set and rotated when needed
- Chakra credentials: token, plugin ID, API version, WABA ID, and phone number ID are correct
- Supabase: `whatsapp_templates` table exists and service role key is server-only
- Usage logs: `api_usage_logs` table exists from `supabase/schema.sql`
- Idempotency: client sends a stable `idempotency_key` for every business event
- Template approval: template status is approved before using it for real outbound messages
- Media hosting: images are public, stable, and served over `https`
- Deployment: Vercel production points to `main`
- Logging: Vercel logs are reviewed for Chakra errors and Supabase errors
- Failure handling: clients handle 400, 404, 500, and 502 responses
- Rate limits: caller should avoid bulk blasts without queueing/throttling
- Daily caps: `SEND_TEMPLATE_DAILY_LIMIT` is set to a realistic customer limit
- Recovery: keep template metadata in Supabase so sends can be reproduced/debugged

## Common Errors

`401 Invalid or missing X-API-Key header`

- `X-API-Key` is missing or does not match `CLIENT_API_KEY` on `/templates` or `/send-template`.

`401 Invalid API key`

- `api_key` is missing or does not match `CLIENT_API_KEY` on the legacy `/send-message` endpoint.

`500 Server configuration is incomplete`

- One or more Chakra environment variables are missing or still set to `replace_with_...`.

`Supabase not configured`

- `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing.

`Template "... " not found in our records`

- The template was not created through `POST /templates`, or Supabase metadata was not saved.

`variables.name is required for this template`

- The send request is missing one of the named variables stored during template creation.

`image_url is required for templates with IMAGE header`

- The stored template has `header.type = "IMAGE"` and the send request did not include `image_url`.

`image_url must be a public https URL`

- The URL must start with `https://` and must be reachable publicly.

`Rate limit exceeded. Please retry later.`

- The API key label exceeded `SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE`.

`Daily sending limit reached.`

- The API key label exceeded `SEND_TEMPLATE_DAILY_LIMIT`.

`Duplicate send blocked.`

- The same `idempotency_key` was already sent, or an identical request was sent inside `DUPLICATE_WINDOW_MINUTES`.

`Template was created in ChakraHQ but failed to save in Supabase`

- Chakra accepted the template, but Supabase failed. Check Supabase table schema, service role key, and logs. You may need to repair metadata manually or recreate the template record.

## Notes

- `/templates` and `/send-template` require `X-API-Key`.
- `/send-message` requires body `api_key`.
- For `/send-template`, clients should always send a stable `idempotency_key`, such as `booking_<booking_id>_confirmation_v1`.
- `phone` is normalized by removing spaces, dashes, and `+`.
- Template creation stores both the original human-readable body and the Chakra-ready body.
- Template send depends on Supabase metadata, not just ChakraHQ template existence.
- Live sending still depends on ChakraHQ and WhatsApp Business onboarding being ready.
- Text and image session messages are subject to WhatsApp's 24-hour customer service window.
- Template messages are the right path for outbound notifications outside the session window.
