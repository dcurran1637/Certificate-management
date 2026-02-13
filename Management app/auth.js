import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";

const TENANT_WELLKNOWN = (tid) =>
  `https://login.microsoftonline.com/${tid}/v2.0/.well-known/openid-configuration`;

const jwks = {}; // cache per-tenant

async function getSigningKey(kid, tid) {
  if (!jwks[tid]) {
    // lazy-load JWKS URI for this tenant
    const meta = await fetch(TENANT_WELLKNOWN(tid)).then(r => r.json());
    jwks[tid] = jwksClient({ jwksUri: meta.jwks_uri });
  }
  const key = await jwks[tid].getSigningKey(kid);
  return key.getPublicKey();
}

export async function validateBearer(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).send("Missing token");

    // Decode header to get kid (do not trust payload before verification)
    const decodedHeader = jwt.decode(token, { complete: true });
    const kid = decodedHeader.header.kid;

    // We verify twice: first without issuer to read tid; then with proper issuer
    const unverified = jwt.decode(token);
    const tid = unverified.tid; // tenant id claim
    if (!tid) return res.status(401).send("No tid");

    const publicKey = await getSigningKey(kid, tid);

    const verified = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      // issuer must be the tenant-specific issuer
      issuer: [`https://login.microsoftonline.com/${tid}/v2.0`],
      audience: "YOUR_API_CLIENT_ID_OR_APPID_URI"
    });

    // attach identity
    req.user = {
      tid: verified.tid,
      oid: verified.oid,
      email: verified.preferred_username,
      name: verified.name
    };
    next();
  } catch (e) {
    console.error(e);
    res.status(401).send("Invalid token");
  }
}