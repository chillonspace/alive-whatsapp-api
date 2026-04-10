# Alive WhatsApp API

Minimal Node.js + Express API for sending WhatsApp messages through ChakraHQ.

## Files

- `package.json` - project info, dependencies, and start script
- `app.js` - shared Express app used by local server and Vercel
- `server.js` - local Node.js entry point for `npm start`
- `api/index.js` - Vercel function entry
- `routes/sendMessage.js` - request validation, phone normalization, and response handling
- `services/chakraService.js` - ChakraHQ API request logic
- `.env.example` - example environment variables
- `vercel.json` - rewrites all routes to the Vercel function

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your `.env` file from `.env.example`

3. Start the server:

```bash
npm start
```

The API will run on `http://localhost:3000` by default.

## Vercel Deployment

1. Push this project to GitHub.
2. Import the repo into Vercel.
3. Add these environment variables in Vercel:
   - `CLIENT_API_KEY`
   - `CHAKRA_ACCESS_TOKEN`
   - `CHAKRA_PLUGIN_ID`
   - `CHAKRA_WA_API_VERSION`
   - `CHAKRA_PHONE_NUMBER_ID`
4. Deploy.

After deployment, your endpoints stay the same:

- `GET /health`
- `POST /send-message`

If you want to test another WhatsApp sender number, update `CHAKRA_PHONE_NUMBER_ID` in Vercel and redeploy.

## Environment Variables

Put these values into your `.env` file:

```env
PORT=3000
CLIENT_API_KEY=replace_with_my_client_api_key
CHAKRA_ACCESS_TOKEN=replace_with_chakra_access_token
CHAKRA_PLUGIN_ID=replace_with_plugin_id
CHAKRA_WA_API_VERSION=v22.0
CHAKRA_PHONE_NUMBER_ID=replace_with_phone_number_id
```

## Endpoints

### GET /health

```bash
curl http://localhost:3000/health
```

Example response:

```json
{
  "success": true,
  "message": "Alive WhatsApp API is running"
}
```

### POST /send-message

This endpoint supports `text`, `image`, and `template` messages through a single request format.

Base request shape:

```json
{
  "api_key": "my_client_api_key",
  "phone": "60123456789",
  "message_type": "text",
  "payload": {}
}
```

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

Image message:

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

Template message:

```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "my_client_api_key",
    "phone": "60123456789",
    "message_type": "template",
    "payload": {
      "template_name": "christmas_promo_23",
      "language": "en",
      "mapping": [
        {
          "schema_property_name": "1",
          "schema_property_value": "John"
        }
      ],
      "header_mapping": [],
      "button_mapping": [],
      "image_url": "https://example.com/banner.jpg"
    }
  }'
```

Success response:

```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

Error response:

```json
{
  "success": false,
  "error": "error message here"
}
```

## Notes

- `api_key` must match `CLIENT_API_KEY` in your `.env`
- if `CLIENT_API_KEY` is missing, the API will return a server configuration error instead of allowing requests
- `phone` is normalized by removing spaces, dashes, and `+`
- `message_type` must be `text`, `image`, or `template`
- text messages require `payload.text`
- image messages require `payload.image_url`, and may include `payload.caption`
- template messages require `payload.template_name`
- template messages may include `payload.language`, `payload.mapping`, `payload.header_mapping`, `payload.button_mapping`, `payload.image_url`, `payload.video_url`, `payload.document_url`, `payload.filename`, and `payload.location`
- template mapping items must include `schema_property_name` and `schema_property_value`
- text and image messages are sent through the standard ChakraHQ messages API
- template messages are sent through the ChakraHQ `send-template-message` API
- live sending still depends on your Chakra / WhatsApp number onboarding being ready
