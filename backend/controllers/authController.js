/**
 * authController.js — Google OAuth login + JWT token issuance.
 *
 * AUTHENTICATION FLOW (step by step):
 *
 *   ┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
 *   │ Browser  │    │ Google OAuth │    │  Our Backend │    │ Frontend     │
 *   │ (User)   │    │ Servers      │    │  (this file) │    │ (store.js)   │
 *   └────┬─────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
 *        │                 │                    │                   │
 *   1.   │ Click "Login"  │                    │                   │
 *        │────────────────►│                    │                   │
 *   2.   │ Google popup    │                    │                   │
 *        │◄────────────────│                    │                   │
 *   3.   │ User signs in   │                    │                   │
 *        │────────────────►│                    │                   │
 *   4.   │ Google ID Token │                    │                   │
 *        │◄────────────────│                    │                   │
 *   5.   │ POST /api/auth/google ──────────────►│                   │
 *        │ { credential: "google_id_token" }    │                   │
 *   6.   │                 │  verifyIdToken()   │                   │
 *        │                 │◄───────────────────│                   │
 *   7.   │                 │  { email, name }   │                   │
 *        │                 │───────────────────►│                   │
 *   8.   │                 │    jwt.sign()      │                   │
 *        │                 │    (OUR token)     │                   │
 *   9.   │◄────────────────────────────────────│                   │
 *        │ { user, token }                      │                   │
 *  10.   │──────────────────────────────────────────────────────────►│
 *        │ Store token in localStorage + Zustand                    │
 *  11.   │ Every future API call:                                   │
 *        │ Authorization: Bearer <our_jwt_token>                    │
 *
 * WHY TWO TOKENS (Google ID Token vs Our JWT):
 * - Google ID Token: Proves identity to Google. Short-lived (~1 hour).
 *   If we used this directly, users would have to re-login every hour.
 * - Our JWT: Issued by US, valid for 30 days. Contains just { email, name }.
 *   We control the expiration and don't depend on Google's token lifecycle.
 *
 * WHY NOT STORE USERS IN A DATABASE:
 * We trust Google as the identity provider. If Google says you're
 * rohan@clevertap.com, that's enough. We don't need a users table because:
 * 1. No user registration (CleverTap employees only, verified by domain)
 * 2. No user profiles (name/email comes from Google)
 * 3. No password management (Google handles it)
 * The JWT itself IS the "session" — stateless, no server-side storage needed.
 */

import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth.js";
import { ok, badRequest } from "../utils/response.js";

/**
 * OAuth2Client — Google's official library for verifying ID tokens.
 *
 * WHY WE PASS GOOGLE_CLIENT_ID TO THE CONSTRUCTOR:
 * The client ID identifies YOUR application to Google. When verifying
 * the ID token, the library checks that the token was issued FOR your app
 * (audience claim matches). This prevents token replay attacks where someone
 * uses a Google token issued for a different app.
 */
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

/**
 * googleAuth — Handles POST /api/auth/google
 *
 * Called when the user completes the Google login popup.
 * Receives the Google ID token, verifies it, and issues our own JWT.
 */
export const googleAuth = async (req, res) => {
  try {
    /**
     * Step 1: Verify the Google ID token.
     *
     * verifyIdToken() does 3 things:
     * 1. Fetches Google's public keys (cached) and verifies the token signature
     * 2. Checks the token hasn't expired
     * 3. Checks the "audience" claim matches our GOOGLE_CLIENT_ID
     *
     * If ANY check fails, it throws → caught below → 400 "Invalid Token"
     *
     * req.body.credential is the raw Google ID token string sent by the frontend
     * after the user completes the Google Sign-In popup.
     */
    const ticket = await client.verifyIdToken({
      idToken: req.body.credential,
      audience: GOOGLE_CLIENT_ID,
    });

    /**
     * Step 2: Extract user info from the verified token.
     *
     * getPayload() returns: { email, name, picture, email_verified, hd, ... }
     * - email: "rohan.jadhav@clevertap.com"
     * - name: "Rohan Jadhav"
     * - hd: "clevertap.com" (hosted domain — Google Workspace)
     *
     * We trust this data because Google verified the token signature.
     */
    const payload = ticket.getPayload();

    /**
     * Step 3: Issue OUR JWT.
     *
     * jwt.sign() creates a token: base64(header).base64(payload).signature
     *
     * What we store in the JWT:
     * - email: For auth middleware to check @clevertap.com domain
     * - name: For the frontend to display "Welcome, Rohan"
     *
     * WHY NOT INCLUDE MORE (picture, role, etc.):
     * JWTs are sent on EVERY request in the Authorization header.
     * Larger JWTs = more bytes per request. We only include what's needed
     * for authentication. The frontend gets the full Google payload separately.
     *
     * expiresIn: "30d" — Token valid for 30 days.
     * After 30 days, the user must re-login via Google. This balances
     * security (not too long) with convenience (not too short for daily use).
     */
    const token = jwt.sign(
      { email: payload.email, name: payload.name },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    /**
     * Step 4: Return both the Google user info AND our JWT.
     *
     * user: Full Google payload (the frontend shows name + picture)
     * token: Our JWT (the frontend stores it for future API calls)
     */
    ok(res, { user: payload, token });
  } catch (e) {
    /**
     * Common failure reasons:
     * - Token expired (user waited too long to complete login)
     * - Invalid token (tampered or from a different app)
     * - Network error reaching Google's public keys
     */
    badRequest(res, "Invalid Token");
  }
};

/**
 * getAuthConfig — Returns the Google Client ID to the frontend.
 *
 * WHY AN ENDPOINT (not hardcoded in frontend):
 * The GOOGLE_CLIENT_ID is different per environment (dev vs prod).
 * By serving it from the backend, the frontend automatically gets
 * the correct one without environment-specific builds.
 *
 * IS IT SAFE TO EXPOSE?
 * Yes. Google Client IDs are PUBLIC by design — they identify your app
 * but don't grant any access. Think of it like your app's "name tag".
 * The actual secret (Client Secret) is never exposed to the frontend.
 */
export const getAuthConfig = (req, res) => {
  ok(res, { clientId: GOOGLE_CLIENT_ID });
};
