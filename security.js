const PRIVILEGED_ROLES = new Set(["admin", "manager"]);

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

module.exports = { personScope, refreshSessionUser, createConcurrencyLimit };
