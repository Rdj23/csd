import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";

// Server-level state
let isServerReady = false;

export const setServerReady = (ready) => {
  isServerReady = ready;
};

export const getServerReady = () => isServerReady;

// Centralized allowed origins - reused by CORS and Socket.IO
export const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://clevertapintel.globalsupportteam.com",
  "https://csd-sigma.vercel.app",
  "https://supportintel.clevertap.com",
];

// Cross-Origin headers + request timeout
export const coopHeaders = (req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
};

// CORS configuration
export const corsMiddleware = cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  maxAge: 86400,
});

// Security headers - XSS, clickjacking, MIME-sniffing protection
export const helmetMiddleware = helmet({
  crossOriginOpenerPolicy: false, // handled by coopHeaders
  crossOriginEmbedderPolicy: false, // handled by coopHeaders
});

// GZIP Compression - reduces payload by 70%
export const compressionMiddleware = compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  },
});

// Body parsing - capped at 5mb to prevent OOM on free tier
export const jsonParser = express.json({ limit: "5mb" });
export const urlencodedParser = express.urlencoded({ limit: "5mb", extended: true });

// Readiness check middleware - allow health/config checks even during startup
export const readinessCheck = (req, res, next) => {
  if (req.path === "/api/health" || req.path === "/api/auth/config") {
    return next();
  }

  if (!isServerReady) {
    return res.status(503).json({
      error: "Server starting up",
      status: "initializing",
      retryAfter: 5,
    });
  }
  next();
};
