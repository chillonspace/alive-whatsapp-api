# Alive WhatsApp Template API Developer Guide

## 1. Overview

Use the Alive WhatsApp API directly.

| Purpose | Endpoint |
| --- | --- |
| Create template | `POST /templates` |
| Get template list and approval status | `GET /templates` |
| Send approved template | `POST /send-template` |

## 2. Base URL

Production:

```text
https://alive-whatsapp-api.vercel.app
```

## 3. Authentication

All endpoints require `X-API-Key`.

```http
X-API-Key: <provided-api-key>
Content-Type: application/json
```

Invalid or missing API key response:

```json
{
  "success": false,
  "error": "Invalid or missing X-API-Key header"
}
```

## 4. Create Template

```http
POST /templates
```

Creates a WhatsApp template and submits it for review. A template cannot be sent until it is approved.

### 4.1 Supported Fields

| Field | Required | Description |
| --- | --- | --- |
| `template_name` | Yes | Template name |
| `category` | Yes | Template category |
| `language` | Yes | Template language |
| `header` | No | Optional text or image header |
| `body` | Yes | Main message body |
| `variables` | Yes | Array of variables used in `body` |
| `examples` | Yes | Example value for each variable |

### 4.2 Field Rules

#### `template_name`

Must use lowercase letters, numbers, and underscores only.

Allowed:

```text
booking_confirm
course_reminder_01
payment_success
```

Not allowed:

```text
Booking Confirm
booking-confirm
booking confirm
```

#### `category`

Supported values:

```text
UTILITY
MARKETING
```

Use `UTILITY` for booking confirmations, payment confirmations, reminders, and course updates.

Use `MARKETING` for promotions, campaigns, announcements, and offers.

#### `language`

Supported values:

| Display | API value |
| --- | --- |
| English | `en` |
| Chinese | `zh_CN` |

#### `header`

Header is optional. If there is no header, do not send the `header` field.

Supported text header:

```json
{
  "header": {
    "type": "TEXT",
    "text": "Alive EDU"
  }
}
```

Rules:

| Rule | Value |
| --- | --- |
| Header type | `TEXT` or `IMAGE` |
| Text header max length | 60 characters |
| Variables in header | Not supported |
| Image header URL | Public `https://` JPG or PNG, max 5MB recommended |

Supported image header:

```json
{
  "header": {
    "type": "IMAGE",
    "example_url": "https://example.com/sample.jpg"
  }
}
```

`example_url` is used only for template review. When sending the approved template, provide the actual image URL in `image_url`.

Do not send:

```json
{
  "header": {}
}
```

Do not send unsupported header types:

```json
{
  "header": {
    "type": "VIDEO"
  }
}
```

#### `body`

Body is required.

Use variables with double curly brackets:

```text
Hi {{name}}, your booking for {{course_name}} is confirmed.
```

Every variable used in `body` must be listed in `variables`.

#### `variables`

Example:

```json
{
  "variables": [
    "name",
    "course_name",
    "intake_date",
    "booking_code"
  ]
}
```

Rules:

- Do not include `{{ }}`.
- Variable names must match the variables used in `body`.
- Every variable must have an example value in `examples`.
- If the template body has no variables, send `"variables": []`.

#### `examples`

Example:

```json
{
  "examples": {
    "name": "John",
    "course_name": "Art Therapy",
    "intake_date": "2026-05-15",
    "booking_code": "BO-12345"
  }
}
```

These sample values are required for template review.

If the template body has no variables, send `"examples": {}`.

### 4.3 Create Template Example

```http
POST /templates
```

```json
{
  "template_name": "booking_confirm",
  "category": "UTILITY",
  "language": "en",
  "header": {
    "type": "TEXT",
    "text": "Alive EDU"
  },
  "body": "Hi {{name}}, your course booking is confirmed!\n\nCourse: {{course_name}}\nIntake Date: {{intake_date}}\nSession Mode: {{session_mode}}\nAmount Paid: RM{{amount_paid}}\nPayment Status: {{payment_status}}\nBooking Code: {{booking_code}}\n\nThank you for choosing Alive EDU.",
  "variables": [
    "name",
    "course_name",
    "intake_date",
    "session_mode",
    "amount_paid",
    "payment_status",
    "booking_code"
  ],
  "examples": {
    "name": "John",
    "course_name": "Art Therapy",
    "intake_date": "2026-05-15",
    "session_mode": "virtual",
    "amount_paid": "95.40",
    "payment_status": "fully_paid",
    "booking_code": "BO-12345"
  }
}
```

### 4.4 Create Template Without Variables

If the body has no variables, `variables` and `examples` are still required.

```json
{
  "template_name": "general_notice",
  "category": "UTILITY",
  "language": "en",
  "body": "Your class reminder has been confirmed. Thank you for choosing Alive EDU.",
  "variables": [],
  "examples": {}
}
```

Rules:

- With variables: put variable names in `variables`, and provide one example value for each variable in `examples`.
- Without variables: send `variables: []` and `examples: {}`.
- Do not omit `variables` or `examples`.

### 4.5 Create Template Success Response

```json
{
  "success": true,
  "template_name": "booking_confirm",
  "language": "en",
  "status": "PENDING",
  "chakra_template_id": "996824306148083"
}
```

`PENDING` means the template is under review. The template cannot be sent until the status becomes `APPROVED`.

### 4.6 Create Template Error Response

If template creation fails, the API returns the reason.

```json
{
  "success": false,
  "error": "This template has too many variables for its length. Reduce the number of variables or increase the message length."
}
```

The UI can display the `error` value directly to the user.

Common errors:

| Error | Meaning |
| --- | --- |
| `template_name must be lowercase...` | Template name format is invalid |
| `category must be one of...` | Category is not supported |
| `language must be one of...` | Language is not supported |
| `header.text must be at most 60 characters` | Header is too long |
| `Variable "x" is declared but not found in body` | Variable list does not match body |
| `examples.x is required` | Missing example value |
| `This template has too many variables for its length` | Body is too short for the number of variables |

## 5. Get Templates

```http
GET /templates
```

Use this endpoint to show the template list and latest approval status.

### 5.1 Response Example

```json
{
  "success": true,
  "templates": [
    {
      "template_name": "booking_confirm",
      "category": "UTILITY",
      "language": "en",
      "status": "APPROVED",
      "header": {
        "type": "TEXT",
        "text": "Alive EDU"
      },
      "body_meta": "Hi {{1}}, your course booking is confirmed!",
      "body_original": "Hi {{name}}, your course booking is confirmed!",
      "variables_order": [
        "name"
      ],
      "mapping": {
        "1": "name"
      },
      "examples": {
        "name": "John"
      },
      "chakra_template_id": "996824306148083",
      "channel": "test"
    }
  ]
}
```

### 5.2 Status Meaning

| Status | Meaning | UI behavior |
| --- | --- | --- |
| `PENDING` | Under review | Show `Pending` |
| `APPROVED` | Ready to send | Enable send |
| `REJECTED` | Rejected | Disable send |
| Other | Platform status | Show as-is |

Recommended UI behavior:

- Open template page: call `GET /templates`.
- If status is `PENDING`: show a Sync button or poll every 30-60 seconds.
- If status is `APPROVED`: allow sending.
- If status is `REJECTED`: disable sending.

## 6. Send Template

```http
POST /send-template
```

Use this endpoint to send an approved template to a WhatsApp number.

Only templates with `APPROVED` status should be sent.

### 6.1 Request Example

```json
{
  "phone": "60123456789",
  "template_name": "booking_confirm",
  "language": "en",
  "variables": {
    "name": "Peter",
    "course_name": "Art Therapy",
    "intake_date": "2026-05-15",
    "session_mode": "virtual",
    "amount_paid": "95.40",
    "payment_status": "fully_paid",
    "booking_code": "BO-REAL01"
  }
}
```

For image header templates, include `image_url`:

```json
{
  "phone": "60123456789",
  "template_name": "promo_image_v1",
  "language": "en",
  "image_url": "https://example.com/real-image.jpg",
  "variables": {
    "name": "Peter"
  }
}
```

### 6.2 Field Rules

| Field | Required | Description |
| --- | --- | --- |
| `phone` | Yes | Recipient phone number |
| `template_name` | Yes | Approved template name |
| `language` | Yes | `en` or `zh_CN` |
| `variables` | Yes | Values for all template variables |
| `image_url` | Required for image header templates | Public image URL to send in the template header |

Phone format:

- Use country code.
- Do not include `+`, spaces, or dashes.

Examples:

| Input | API value |
| --- | --- |
| `+60 12-345 6789` | `60123456789` |
| `+60 11-1123 4158` | `601111234158` |

### 6.3 Success Response

```json
{
  "success": true,
  "template_name": "booking_confirm",
  "language": "en",
  "phone": "60123456789"
}
```

This means the message was accepted for sending. Actual WhatsApp delivery may take a few seconds to a few minutes.

### 6.4 Send Error Response

```json
{
  "success": false,
  "error": "No approved message template found for template booking_confirm"
}
```

Common errors:

| Error | Meaning |
| --- | --- |
| `phone is required` | Missing phone |
| `template_name is required` | Missing template name |
| `language is required` | Missing language |
| `variables must be an object...` | Variables format is wrong |
| `variables.name is required for this template` | Missing required variable |
| `image_url is required for templates with IMAGE header` | Missing image URL for an image header template |
| `image_url must be a public https URL` | Image URL is not valid |
| `Template "x" not found` | Template was not created through API or metadata is missing |
| `No approved message template found` | Template is not approved yet |

## 7. Full Flow

1. Create template: `POST /templates`
2. Wait for approval: `GET /templates`
3. Once approved: `POST /send-template`

Do not send templates while status is `PENDING` or `REJECTED`.

## 8. Current Version Limits

Supported:

| Item | Supported values |
| --- | --- |
| Category | `UTILITY`, `MARKETING` |
| Language | `en`, `zh_CN` |
| Header | Optional `TEXT` or `IMAGE` |
| Body variables | Supported |

Not supported in this version:

- Footer
- Buttons
- Video or document header
- Header variables

## 9. Quick Curl Examples

### Create Template

```bash
curl -X POST https://alive-whatsapp-api.vercel.app/templates \
  -H "X-API-Key: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "template_name": "booking_confirm",
    "category": "UTILITY",
    "language": "en",
    "body": "Hi {{name}}, your booking is confirmed.",
    "variables": ["name"],
    "examples": {
      "name": "John"
    }
  }'
```

### Get Templates

```bash
curl https://alive-whatsapp-api.vercel.app/templates \
  -H "X-API-Key: <api-key>"
```

### Send Template

```bash
curl -X POST https://alive-whatsapp-api.vercel.app/send-template \
  -H "X-API-Key: <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "60123456789",
    "template_name": "booking_confirm",
    "language": "en",
    "variables": {
      "name": "Peter"
    }
  }'
```

## 10. Developer Notes

- Always create templates through this API.
- Always check template status before sending.
- Only send templates with `APPROVED` status.
- If template creation fails, show the returned error message to the user.
- Keep body text natural and long enough when using many variables.
- Phone number must include country code.
- Delivery may take a few seconds to a few minutes.
- `variables` is always an array.
- `examples` is always an object.
- No variables: use `variables: []` and `examples: {}`.
