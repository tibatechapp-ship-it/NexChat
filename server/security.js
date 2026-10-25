const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "blob:", "data:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "no-referrer" },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: "too many attempts" },
  standardHeaders: true, legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  message: { error: "rate limit" },
  standardHeaders: true, legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  message: { error: "upload rate limit" },
  standardHeaders: true, legacyHeaders: false,
});

function errorHandler(err, req, res, next) {
  console.error(`[ERR] ${req.method} ${req.path}:`, err.message);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === "production" ? "server error" : err.message,
  });
}

function requireJson(req, res, next) {
  if (["POST", "PUT", "PATCH"].includes(req.method) &&
      !req.is("application/json") && !req.is("application/octet-stream")) {
    return res.status(415).json({ error: "unsupported media type" });
  }
  next();
}

module.exports = { securityHeaders, authLimiter, apiLimiter, uploadLimiter, errorHandler, requireJson };
