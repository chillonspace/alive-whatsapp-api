const assert = require('node:assert/strict');
const test = require('node:test');

const templatesRoute = require('../src/routes/templates');
const sendTemplateRoute = require('../src/routes/sendTemplate');
const { buildCreateTemplateRequest } = require('../src/services/chakraTemplateService');
const { buildTemplatePayload } = require('../services/chakraService');

const baseCreateBody = {
  template_name: 'booking_confirm',
  category: 'UTILITY',
  language: 'en',
  body: 'Hi {{name}}, your booking is confirmed.',
  variables: ['name'],
  examples: {
    name: 'John'
  }
};

test('create template validation still accepts no header', () => {
  assert.equal(templatesRoute.validateCreateBody(baseCreateBody), null);
  assert.equal(templatesRoute.normalizeHeader(undefined), null);
});

test('create template validation still accepts text header', () => {
  const body = {
    ...baseCreateBody,
    header: {
      type: 'TEXT',
      text: 'Alive EDU'
    }
  };

  assert.equal(templatesRoute.validateCreateBody(body), null);
  assert.deepEqual(templatesRoute.normalizeHeader(body.header), {
    type: 'TEXT',
    text: 'Alive EDU'
  });
});

test('create template validation accepts image header with public https example url', () => {
  const body = {
    ...baseCreateBody,
    header: {
      type: 'IMAGE',
      example_url: 'https://example.com/sample.jpg'
    }
  };

  assert.equal(templatesRoute.validateCreateBody(body), null);
  assert.deepEqual(templatesRoute.normalizeHeader(body.header), {
    type: 'IMAGE',
    example_url: 'https://example.com/sample.jpg'
  });
});

test('create template validation rejects invalid image header fields', () => {
  assert.match(
    templatesRoute.validateCreateBody({
      ...baseCreateBody,
      header: { type: 'IMAGE' }
    }),
    /header\.example_url is required/
  );

  assert.match(
    templatesRoute.validateCreateBody({
      ...baseCreateBody,
      header: { type: 'IMAGE', example_url: 'http://example.com/sample.jpg' }
    }),
    /header\.example_url must be a public https URL/
  );

  assert.match(
    templatesRoute.validateCreateBody({
      ...baseCreateBody,
      header: { type: 'IMAGE', text: 'Alive EDU', example_url: 'https://example.com/sample.jpg' }
    }),
    /header\.text is not supported/
  );
});

test('chakra create template request builds image header component', () => {
  const request = buildCreateTemplateRequest({
    name: 'promo_image_v1',
    category: 'MARKETING',
    language: 'en',
    bodyMeta: 'Hi {{1}}, check this out.',
    examples: { name: 'John' },
    variablesOrder: ['name'],
    header: {
      type: 'IMAGE',
      example_url: 'https://example.com/sample.jpg'
    }
  });

  assert.deepEqual(request.components[0], {
    type: 'HEADER',
    format: 'IMAGE',
    example: {
      header_handle: ['https://example.com/sample.jpg']
    }
  });
  assert.equal(request.components[1].type, 'BODY');
});

test('send-template requires image_url only for image header templates', () => {
  const imageHeader = { type: 'IMAGE', example_url: 'https://example.com/sample.jpg' };

  assert.equal(
    sendTemplateRoute.validateTemplateImageUrl(imageHeader, ''),
    'image_url is required for templates with IMAGE header'
  );
  assert.equal(
    sendTemplateRoute.validateTemplateImageUrl(imageHeader, 'http://example.com/real.jpg'),
    'image_url must be a public https URL'
  );
  assert.equal(
    sendTemplateRoute.validateTemplateImageUrl(imageHeader, 'https://example.com/real.jpg'),
    null
  );
  assert.equal(sendTemplateRoute.validateTemplateImageUrl({ type: 'TEXT', text: 'Alive EDU' }, ''), null);
});

test('send-template payload includes image_url only for image header templates', () => {
  const mapping = [{ schema_property_name: '1', schema_property_value: 'Peter' }];
  const payload = sendTemplateRoute.buildSendTemplatePayload({
    templateName: 'promo_image_v1',
    language: 'en',
    mapping,
    header: { type: 'IMAGE' },
    imageUrl: 'https://example.com/real.jpg'
  });

  assert.equal(payload.image_url, 'https://example.com/real.jpg');
  assert.deepEqual(payload.mapping, mapping);

  const textPayload = sendTemplateRoute.buildSendTemplatePayload({
    templateName: 'booking_confirm',
    language: 'en',
    mapping,
    header: { type: 'TEXT', text: 'Alive EDU' },
    imageUrl: 'https://example.com/real.jpg'
  });

  assert.equal(textPayload.image_url, undefined);
});

test('chakra send template payload maps image_url to imageUrl', () => {
  const payload = buildTemplatePayload('12345', {
    template_name: 'promo_image_v1',
    language: 'en',
    mapping: [],
    header_mapping: [],
    button_mapping: [],
    image_url: 'https://example.com/real.jpg'
  });

  assert.equal(payload.imageUrl, 'https://example.com/real.jpg');
  assert.equal(payload.whatsappPhoneNumberId, '12345');
});
