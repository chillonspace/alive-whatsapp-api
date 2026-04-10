require('dotenv').config();

const express = require('express');
const sendMessageRouter = require('./routes/sendMessage');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Alive WhatsApp API is running'
  });
});

app.use('/', sendMessageRouter);

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
