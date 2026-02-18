import mariadb from "mariadb";
import bcrypt from "bcrypt";

// --- MariaDB-backed user & credential helpers ---
// Configure via env: DB_HOST, DB_USER, DB_PASS, DB_NAME
const dbPool = mariadb.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "certapp",
  connectionLimit: 5
});


// Create a new profile + credential (transactional)
export async function createUser(email, password, name = null) {
  if (!email || !password) throw new Error("email and password required");
  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    // create profile
    const profileRes = await conn.query(
      'INSERT INTO profiles (email, name) VALUES (?, ?)',
      [email, name]
    );
    const profileId = profileRes.insertId;

    // create credential row
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      'INSERT INTO credentials (profile_id, provider, password_hash) VALUES (?, ?, ?)',
      [profileId, 'local', hash]
    );

    await conn.commit();
    return profileId;
  } catch (e) {
    try { await conn.rollback(); } catch (er) { /* ignore */ }
    // rethrow so caller can map to 409 for duplicates
    throw e;
  } finally {
    conn.release();
  }
}

// Fetch profile + credential info by email (joins profiles->credentials)
export async function getUserByEmail(email) {
  const conn = await dbPool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT p.id AS id, p.email AS email, p.name AS name,
              c.id AS credential_id, c.provider, c.password_hash
       FROM profiles p
       LEFT JOIN credentials c ON c.profile_id = p.id AND c.provider = 'local'
       WHERE p.email = ? LIMIT 1`,
      [email]
    );
    return rows && rows[0] ? rows[0] : null;
  } finally {
    conn.release();
  }
}

export async function verifyUserCredentials(email, password) {
  const user = await getUserByEmail(email);
  if (!user || !user.password_hash) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? { id: user.id, email: user.email, name: user.name } : null;
}

// Optional: helper to close pool (useful for tests)
export async function closeDb() {
  try { await dbPool.end(); } catch (e) { /* ignore */ }
}