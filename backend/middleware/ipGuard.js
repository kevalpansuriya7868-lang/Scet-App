const cfg = require('../config');
const { buildMatcher } = require('../utils/ipMatcher');

const isAllowed = buildMatcher(cfg.allowedIps);

/**
 * Blocks every request whose client address is not in ALLOWED_IPS.
 * Uses req.ip only (Express derives it from the socket, or from X-Forwarded-For
 * ONLY for the proxy hops declared in TRUST_PROXY) - the header is never read directly,
 * so it cannot be spoofed by a client.
 */
module.exports = function ipGuard(req, res, next) {
  if (isAllowed(req.ip)) return next();
  console.warn(`[ipGuard] blocked ${req.method} ${req.originalUrl} from ${req.ip}`);
  return res.status(403).json({
    error: 'Unauthorized network: this system can only be used from the authorised SCET lab network.',
    code: 'IP_NOT_ALLOWED',
  });
};
