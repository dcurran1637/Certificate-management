const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const {
  personScope,
  refreshSessionUser,
  createConcurrencyLimit,
  csrfTokenMatches,
  requireCsrf,
  isAllowedUploadMimeType,
  validateBootstrapAdminConfig
} = require("../security");
const { escapeIcsText, csvCell } = require("../public/export-utils");

test("regular users are scoped to their own person id", () => {
  assert.deepEqual(personScope({ role: "user", person_id: 42 }, "tr.person_id"), {
    clause: "tr.person_id=?",
    params: [42]
  });
});

test("admins and managers can query all people", () => {
  for (const role of ["admin", "manager"]) {
    assert.deepEqual(personScope({ role, person_id: 42 }, "tr.person_id"), {
      clause: "",
      params: []
    });
  }
});

test("session authorization uses the current database role", () => {
  const refreshed = refreshSessionUser(
    { user_id: 7, person_id: 42, role: "admin" },
    { person_id: 42, role: "user" }
  );

  assert.equal(refreshed.role, "user");
});

test("deleted or unlinked accounts cannot keep an authenticated identity", () => {
  assert.equal(refreshSessionUser({ user_id: 7 }, undefined), null);
  assert.equal(refreshSessionUser({ user_id: 7 }, { person_id: null, role: "admin" }), null);
});

test("CSRF tokens require a matching value and reject missing or unequal tokens", () => {
  assert.equal(csrfTokenMatches("random-token", "random-token"), true);
  assert.equal(csrfTokenMatches("random-token", "different-token"), false);
  assert.equal(csrfTokenMatches("random-token", ""), false);
  assert.equal(csrfTokenMatches("random-token", undefined), false);
});

test("CSRF middleware checks every state-changing method", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    let statusCode;
    let continued = false;
    requireCsrf(
      { method, session: { csrfToken: "session-token" }, get: () => "wrong-token" },
      { status(code) { statusCode = code; return this; }, json() {} },
      () => { continued = true; }
    );
    assert.equal(statusCode, 403, `${method} without the session token must be rejected`);
    assert.equal(continued, false);
  }

  let continued = false;
  requireCsrf(
    { method: "POST", session: { csrfToken: "session-token" }, get: () => "session-token" },
    {},
    () => { continued = true; }
  );
  assert.equal(continued, true);

  requireCsrf({ method: "GET" }, {}, () => { continued = true; });
  assert.equal(continued, true);
});

test("uploads allow only PDF, JPEG, and PNG MIME types", () => {
  for (const mimeType of ["application/pdf", "image/jpeg", "image/png"]) {
    assert.equal(isAllowedUploadMimeType(mimeType), true);
  }
  for (const mimeType of ["image/gif", "image/webp", "image/svg+xml", "text/plain", ""]) {
    assert.equal(isAllowedUploadMimeType(mimeType), false);
  }
});

test("bootstrap admin configuration normalizes the email and validates required fields", () => {
  assert.deepEqual(
    validateBootstrapAdminConfig({
      email: " Admin@Example.com ",
      name: " Initial Admin ",
      password: "long-unique-password"
    }),
    {
      email: "admin@example.com",
      name: "Initial Admin",
      password: "long-unique-password"
    }
  );

  for (const config of [
    { email: "", name: "Initial Admin", password: "long-unique-password" },
    { email: "admin@example.com", name: "", password: "long-unique-password" },
    { email: "admin@example.com", name: "Initial Admin", password: "short" },
    { email: "admin@example.com", name: "Initial Admin", password: "é".repeat(37) }
  ]) {
    assert.throws(() => validateBootstrapAdminConfig(config));
  }
});

test("installation instructions do not include inline username/password pairs", () => {
  const instructions = fs.readFileSync(path.join(__dirname, "..", "installs required.md"), "utf8");
  assert.doesNotMatch(instructions, /\b[a-z][a-z0-9_-]*\/[a-z0-9!@#$%^&*._-]{8,}\b/i);
});

test("ICS text escapes injected properties and delimiters", () => {
  assert.equal(escapeIcsText("safe\r\nATTENDEE:x,semi;\\end"), "safe\\nATTENDEE:x\\,semi\\;\\\\end");
});

test("CSV cells neutralize formula-leading values", () => {
  assert.equal(csvCell("=1+1"), "\"'=1+1\"");
  assert.equal(csvCell("  @SUM(A1:A2)"), "\"'  @SUM(A1:A2)\"");
  assert.equal(csvCell("ordinary, text"), "\"ordinary, text\"");
});

test("upload concurrency slots release on response completion and disconnect", () => {
  const limit = createConcurrencyLimit(1);
  const activeResponse = new EventEmitter();
  let activeAccepted = false;
  limit({}, activeResponse, () => { activeAccepted = true; });
  assert.equal(activeAccepted, true);

  let rejectedStatus;
  limit({}, { status(code) { rejectedStatus = code; return this; }, json() {} }, () => {});
  assert.equal(rejectedStatus, 503);

  activeResponse.emit("close");
  let nextAccepted = false;
  limit({}, new EventEmitter(), () => { nextAccepted = true; });
  assert.equal(nextAccepted, true);
});
