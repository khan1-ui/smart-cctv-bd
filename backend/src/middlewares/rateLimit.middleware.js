/**
 * Lightweight in-memory rate limiter for a single Render web-service instance.
 * For multi-instance production deployments, replace with a shared store (Redis).
 */
const createRateLimiter = ({ windowMs = 60_000, max = 30, message = "Too many requests. Please try again later." } = {}) => {
  const buckets = new Map();

  // Periodically prune expired entries so the map does not grow forever.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanup.unref?.();

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message });
    }

    return next();
  };
};

module.exports = createRateLimiter;
