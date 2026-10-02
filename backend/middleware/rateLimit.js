/** Tiny in-memory sliding-window limiter (single-instance; use Redis if you scale out). */
module.exports = function rateLimit({ windowMs = 60e3, max = 5, key }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.every((t) => now - t > windowMs)) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    arr.push(now);
    hits.set(k, arr);
    next();
  };
};
