require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const marketRoutes = require('./routes/market');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : '*'
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    name: 'AI NSE Scanner V11 Backend',
    message: 'Backend is running',
    endpoints: ['/health', '/api/market/quote', '/api/market/decision', '/api/market/scan', '/api/market/events']
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', time: new Date().toISOString() });
});

app.use('/api/market', marketRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(err.status || 500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

app.listen(PORT, () => {
  console.log(`AI NSE Scanner V11 Backend running on port ${PORT}`);
});
