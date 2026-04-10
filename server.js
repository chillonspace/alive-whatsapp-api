require('dotenv').config();

const express = require('express');
const sendMessageRouter = require('./routes/sendMessage');

const app = express();
const port = process.env.PORT || 3000;

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
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
