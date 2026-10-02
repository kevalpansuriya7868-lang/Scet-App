const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const cfg = require('./config');
const { attachUser } = require('./middleware/auth');
const { startScheduler } = require('./utils/scheduler');

const app = express();

// Trust reverse proxy (e.g. Render / Cloudflare)
if (cfg.trustProxy !== false) {
  app.set('trust proxy', cfg.trustProxy);
} else if (cfg.isProd) {
  app.set('trust proxy', 1);
}

// CORS setup: allow credentials and dynamically reflect request origin for cross-domain communication
app.use(cors({
  origin: true,
  credentials: true,
}));

// Body & Cookie Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Attach authenticated user to req.user if session cookie is present
app.use(attachUser);

// Import Route modules from backend/routes
const authRoutes = require('./routes/auth');
const auditRoutes = require('./routes/audit');
const branchesRoutes = require('./routes/branches');
const catalogRoutes = require('./routes/catalog');
const inventoryRoutes = require('./routes/inventory');
const issuesRoutes = require('./routes/issues');
const reportsRoutes = require('./routes/reports');
const requestsRoutes = require('./routes/requests');
const studentRoutes = require('./routes/student');

// Register API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/issues', issuesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/me', studentRoutes); // Supports student portal calls (/api/me/requests, /api/me/issues, etc.)

// Base health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'API is running successfully' });
});

// Centralized JSON Error Handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err.message || err);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code: err.code || undefined,
  });
});

// ==========================================
// EXPORT FOR RENDER & SERVERLESS RUNTIMES
// ==========================================
module.exports = app;

// Local / Render execution wrapper
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startScheduler();
  });
}