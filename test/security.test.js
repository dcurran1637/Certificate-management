const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { personScope, refreshSessionUser, createConcurrencyLimit } = require("../security");
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
