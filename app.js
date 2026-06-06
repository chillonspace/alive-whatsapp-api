const { loadEnv } = require('./src/config/env');

loadEnv();

const express = require('express');
const sendMessageRouter = require('./routes/sendMessage');
const templatesRouter = require('./src/routes/templates');
const sendTemplateRouter = require('./src/routes/sendTemplate');
const chakraGroupTestRouter = require('./src/routes/chakraGroupTest');
const aliveGroupsRouter = require('./src/routes/aliveGroups');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'Alive WhatsApp Template API',
    status: 'ok'
  });
});

app.use('/', sendMessageRouter);
app.use('/', templatesRouter);
app.use('/', sendTemplateRouter);
app.use('/', chakraGroupTestRouter);
app.use('/', aliveGroupsRouter);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON body'
    });
  }

  const statusCode = err.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

module.exports = app;
