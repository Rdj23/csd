import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth.js";
import { ok, badRequest } from "../utils/response.js";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

export const googleAuth = async (req, res) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken: req.body.credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const token = jwt.sign(
      { email: payload.email, name: payload.name },
      JWT_SECRET,
      { expiresIn: "30d" }
    );
    ok(res, { user: payload, token });
  } catch (e) {
    badRequest(res, "Invalid Token");
  }
};

export const getAuthConfig = (req, res) => {
  ok(res, { clientId: GOOGLE_CLIENT_ID });
};
