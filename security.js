const crypto = require("node:crypto");

const PRIVILEGED_ROLES = new Set(["admin", "manager"]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

function isAllowedUploadMimeType(mimeType) {
  return ALLOWED_UPLOAD_MIME_TYPES.has(mimeType);
}

function csrfTokenMatches(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function requireCsrf(req, res, next) {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();

  if (!csrfTokenMatches(req.session?.csrfToken, req.get("X-CSRF-Token"))) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
}

function personScope(user, column) {
  if (PRIVILEGED_ROLES.has(user.role)) {
    return { clause: "", params: [] };
  }

  return { clause: `${column}=?`, params: [user.person_id] };
}

function refreshSessionUser(sessionUser, databaseUser) {
  if (!databaseUser?.person_id) return null;

  return {
    ...sessionUser,
    person_id: databaseUser.person_id,
    role: databaseUser.role
  };
}

function createConcurrencyLimit(maxConcurrent) {
  let active = 0;

  return (req, res, next) => {
    if (active >= maxConcurrent) {
      return res.status(503).json({ error: "Uploads temporarily unavailable" });
    }

    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };

    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

function validateBootstrapAdminConfig({ email, name, password }) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedName = typeof name === "string" ? name.trim() : "";

  if (
    !normalizedName
    || normalizedName.length > 255
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    || normalizedEmail.length > 255
    || typeof password !== "string"
    || password.length < 12
    || Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "Bootstrap admin requires a valid email, name, and a password between 12 and 72 UTF-8 bytes"
    );
  }

  return { email: normalizedEmail, name: normalizedName, password };
}

module.exports = {
  personScope,
  refreshSessionUser,
  createConcurrencyLimit,
  csrfTokenMatches,
  requireCsrf,
  isAllowedUploadMimeType,
  validateBootstrapAdminConfig
};
