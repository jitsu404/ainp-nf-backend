import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * General API limit. Generous because many users at one institute may share an IP.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests, please try again later')),
});

/** Brute-force protection for sign-in. Successful logins don't count towards the limit. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'TOO_MANY_LOGIN_ATTEMPTS', 'Too many sign-in attempts, please wait 15 minutes')),
});
