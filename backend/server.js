const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Import Route modules from your backend/routes directory
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

// Base health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'API is running successfully' });
});

// ==========================================
// REQUIRED FOR FIREBASE CLOUD FUNCTIONS
// ==========================================

// 1. Export the Express app instance so Firebase can handle requests
module.exports = app;

// 2. Local execution wrapper (prevents port binding conflict when loaded by Firebase)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running locally on port ${PORT}`);
  });
}