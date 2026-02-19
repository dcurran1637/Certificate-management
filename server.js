// ======================================================
//  server.js  (STRICT RBAC — ADMIN / MANAGER / USER)
//  Same-origin HTTP setup: frontend served from /public
// ======================================================

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const multer = require("multer");
const bcrypt = require("bcrypt");

const {
  PORT = 5000,
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASS,
  DB_NAME,
  SESSION_SECRET,
  UPLOAD_DIR = "uploads",
} = process.env;

const app = express();

// ------------------------------------------------------
// Core middleware
// ------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions: Same-origin HTTP friendly
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    }
  })
);

// Disable caching for API responses
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.set("Cache-Control", "no-store");
  }
  next();
});

// ------------------------------------------------------
// Static Assets
// ------------------------------------------------------
const PUBLIC_DIR = path.resolve(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(path.resolve(UPLOAD_DIR)));

// ------------------------------------------------------
// MySQL
// ------------------------------------------------------
const pool = mysql.createPool({
  host: DB_HOST,
  port: +DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  connectionLimit: 10,
  timezone: "Z",
  supportBigNumbers: true,
  dateStrings: true,
});

async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// ------------------------------------------------------
// Role Guards
// ------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session?.user)
    return res.status(401).json({ error: "Not authenticated" });
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    const role = req.session?.user?.role;
    if (!role) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

function allowSelfOrRoles(resolveTargetPID, ...roles) {
  return async (req, res, next) => {
    const me = req.session?.user;
    if (!me) return res.status(401).json({ error: "Not authenticated" });

    const pid = await resolveTargetPID(req);
    if (!pid) return res.status(400).json({ error: "Missing/invalid person_id" });

    if (me.person_id === Number(pid)) return next();
    if (roles.includes(me.role)) return next();

    return res.status(403).json({ error: "Forbidden" });
  };
}

function likeWrap(s) {
  return `%${String(s).replace(/[%_]/g, (m) => "\\" + m)}%`;
}

// ------------------------------------------------------
// Auth Register
// ------------------------------------------------------
app.post("/api/auth/register", async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email & password required" });

  const hash = await bcrypt.hash(password, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [u] = await conn.query(
      `INSERT INTO users (email, username, password_hash, role)
       VALUES (?, ?, ?, 'user')`,
      [email, username || null, hash]
    );

    const userId = u.insertId;

    const [p] = await conn.query(
      `INSERT INTO people (display_name, email, is_active)
       VALUES (?, ?, 1)`,
      [username || email, email]
    );
    const personId = p.insertId;

    await conn.query(`UPDATE users SET person_id=? WHERE user_id=?`, [
      personId,
      userId,
    ]);

    await conn.commit();

    res.json({ success: true, user_id: userId, person_id: personId });
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY")
      return res.status(400).json({ error: "Email already registered" });
    res.status(500).json({ error: "Registration failed" });
  } finally {
    conn.release();
  }
});

// ------------------------------------------------------
// Auth Login
// ------------------------------------------------------
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Missing login fields" });

  const [rows] = await pool.query(
    `SELECT user_id, email, username, password_hash, person_id, role
     FROM users WHERE email=? LIMIT 1`,
    [email]
  );
  if (!rows.length)
    return res.status(401).json({ error: "Invalid email or password" });

  const user = rows[0];

  if (!(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: "Invalid email or password" });

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [pr] = await conn.query(
      `SELECT person_id FROM people WHERE email=? LIMIT 1`,
      [email]
    );

    let personId = pr[0]?.person_id;

    if (!personId) {
      const displayName = user.username || email;
      const [ins] = await conn.query(
        `INSERT INTO people (display_name, email, is_active)
         VALUES (?, ?, 1)`,
        [displayName, email]
      );
      personId = ins.insertId;
    }

    if (!user.person_id) {
      await conn.query(`UPDATE users SET person_id=? WHERE user_id=?`, [
        personId,
        user.user_id,
      ]);
    }

    await conn.commit();

    req.session.user = {
      user_id: user.user_id,
      email: user.email,
      username: user.username,
      person_id: personId,
      role: user.role || "user"
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: "Login sync failed" });
  } finally {
    conn.release();
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ------------------------------------------------------
// Dashboard Stats (expiry-aware)
// ------------------------------------------------------
app.get("/api/stats", requireAuth, async (req, res, next) => {
  try {
    const [staff] = await q(`SELECT COUNT(*) AS n FROM people WHERE is_active=1`);
    const [courses] = await q(`SELECT COUNT(*) AS n FROM courses WHERE is_active=1`);

    // Training_records
    const [currentInt] = await q(
      `SELECT COUNT(*) AS n
       FROM training_records
       WHERE expiry_date IS NULL OR expiry_date >= CURDATE()`
    );

    const [expSoonInt] = await q(
      `SELECT COUNT(*) AS n
       FROM training_records
       WHERE expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)`
    );

    // 3rd‑party (optional — include in dashboard)
    const [currentTP] = await q(
      `SELECT COUNT(*) AS n
       FROM third_party_certifications
       WHERE expiry_date IS NULL OR expiry_date >= CURDATE()`
    );

    const [expSoonTP] = await q(
      `SELECT COUNT(*) AS n
       FROM third_party_certifications
       WHERE expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)`
    );

    res.json({
      totalStaff: staff.n,
      activeCourses: courses.n,
      expiringSoon: expSoonInt.n + expSoonTP.n,
      currentCerts: currentInt.n + currentTP.n,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------
// COURSES LIST
// ------------------------------------------------------

app.get("/api/courses", requireAuth, async (_req, res, next) => {
  try {
    const rows = await q(
      `SELECT 
          c.course_id,
          c.name,
          c.type,
          c.validity_days,
          cat.name AS category,
          prov.name AS provider
       FROM courses c
       LEFT JOIN categories cat ON cat.category_id = c.category_id
       LEFT JOIN providers  prov ON prov.provider_id = c.provider_id
       WHERE c.is_active = 1
       ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});


app.get("/api/people",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    try {
      const people = await q(
        `SELECT person_id, display_name AS name, email
         FROM people
         WHERE is_active = 1
         ORDER BY display_name`
      );

      const results = [];

      for (const p of people) {

        // INTERNAL TRAINING COUNTS
        const [intCounts] = await q(
          `SELECT
              COUNT(*) AS total,
              SUM(
                CASE
                  WHEN expiry_date IS NULL THEN 1
                  WHEN expiry_date < CURDATE() THEN 0
                  WHEN expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
                    THEN 0
                  ELSE 1
                END
              ) AS current,
              SUM(expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)) AS expiring_soon,
              SUM(expiry_date < CURDATE()) AS expired
           FROM training_records
           WHERE person_id=?`,
          [p.person_id]
        );

        // THIRD PARTY COUNTS
        const [tpCounts] = await q(
          `SELECT
              COUNT(*) AS total,
              SUM(expiry_date IS NULL OR expiry_date >= CURDATE()) AS current,
              SUM(expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)) AS expiring_soon,
              SUM(expiry_date < CURDATE()) AS expired
           FROM third_party_certifications
           WHERE person_id=?`,
          [p.person_id]
        );

        results.push({
          person_id: p.person_id,
          name: p.name,
          email: p.email,
          total_training: intCounts.total + tpCounts.total,
          current: Number(intCounts.current) + Number(tpCounts.current),
          expiring_soon: Number(intCounts.expiring_soon) + Number(tpCounts.expiring_soon),
          expired: Number(intCounts.expired) + Number(tpCounts.expired)
        });
      }

      res.json(results);
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// PERSON SUMMARY (training + 3rd-party)  — returns role too
// ------------------------------------------------------
app.get(
  "/api/person/:id/summary",
  requireAuth,
  allowSelfOrRoles((req) => Number(req.params.id), "admin", "manager"),
  async (req, res, next) => {
    const personId = Number(req.params.id);

    try {
      // Return role so the Role selector can be populated correctly
      const [person] = await q(
        `SELECT p.person_id, p.display_name AS name, p.email, u.role
           FROM people p
           LEFT JOIN users u ON u.person_id = p.person_id
          WHERE p.person_id = ?
          LIMIT 1`,
        [personId]
      );

      const training = await q(
        `SELECT 
            tr.training_record_id,
            c.name AS course,
            tr.completion_date AS completed,
            tr.expiry_date   AS expires,
            tr.status,
            tr.assessor      AS assessor
        FROM training_records tr
        JOIN courses c ON c.course_id = tr.course_id
        WHERE tr.person_id = ?
        ORDER BY tr.completion_date DESC`,
        [personId]
      );

      // Load attachments for all training records
      const attachments = await q(
        `SELECT training_record_id, file_path, mime_type
          FROM attachments
          WHERE training_record_id IN (
            SELECT training_record_id 
            FROM training_records 
            WHERE person_id=?
          )`,
        [personId]
      );

      // Attach them to training objects
      training.forEach(r => {
        const a = attachments.find(x => x.training_record_id === r.training_record_id);
        r.file_path = a?.file_path || null;
        r.mime_type = a?.mime_type || null;
      });

      const thirdparty = await q(
        `SELECT 
            cert_id, 
            title, 
            provider, 
            completion_date, 
            expiry_date, 
            notes,
            file_path,       
            mime_type           
        FROM third_party_certifications
        WHERE person_id = ?
        ORDER BY completion_date DESC`,
        [personId]
      );

      res.json({ person, training, thirdparty });
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// CREATE COURSE (ADMIN/MANAGER)
// ------------------------------------------------------
app.post(
  "/api/courses",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    try {
      let {
        name,
        description,
        type,
        categoryName,
        providerName,
        validityDays
      } = req.body;

      name = (name || "").trim();
      type = (type || "Individual Training").trim();
      categoryName = (categoryName || "Other").trim();
      providerName = (providerName || "").trim();

      // normalise validity days
      const vd = Number.isFinite(+validityDays) && +validityDays >= 0 ? +validityDays : null;

      if (!name) return res.status(400).json({ error: "Course name required" });

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // --- Category (ensure exists, get id)
        let [rows] = await conn.query(
          `SELECT category_id FROM categories WHERE name=? LIMIT 1`,
          [categoryName]
        );
        let category_id = rows[0]?.category_id;
        if (!category_id) {
          const [ins] = await conn.query(
            `INSERT INTO categories (name) VALUES (?)`,
            [categoryName]
          );
          category_id = ins.insertId;
        }

        // --- Provider (optional)
        let provider_id = null;
        if (providerName) {
          [rows] = await conn.query(
            `SELECT provider_id FROM providers WHERE name=? LIMIT 1`,
            [providerName]
          );
          provider_id = rows[0]?.provider_id;
          if (!provider_id) {
            const [ins] = await conn.query(
              `INSERT INTO providers (name) VALUES (?)`,
              [providerName]
            );
            provider_id = ins.insertId;
          }
        }

        // --- Insert Course
        // If your 'courses' table does not have 'description', remove it from the query and params.
        const sql = `
          INSERT INTO courses
            (name, description, type, category_id, provider_id, validity_days, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `;
        const [result] = await conn.query(sql, [
          name,
          description || null,
          type,
          category_id,
          provider_id,
          vd
        ]);

        await conn.commit();
        res.json({ success: true, course_id: result.insertId });
      } catch (err) {
        await conn.rollback();
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(400).json({ error: "A course with this name already exists" });
        }
        next(err);
      } finally {
        conn.release();
      }
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// RECORDS LIST — internal + 3rd‑party
// ------------------------------------------------------
app.get("/api/records", requireAuth, async (req, res, next) => {
  const { q: search, status = "all" } = req.query;

  const where = [];
  const params = [];

  if (status !== "all") {
    where.push("tr.status=?");
    params.push(status);
  }

  if (search) {
    where.push("(p.display_name LIKE ? OR p.email LIKE ? OR c.name LIKE ?)");
    params.push(likeWrap(search), likeWrap(search), likeWrap(search));
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    // Internal training
    const training = await q(
      `SELECT 
          tr.training_record_id,
          p.display_name AS employee,
          p.email,
          c.name AS course,
          tr.completion_date AS completed,
          tr.expiry_date AS expires,
          tr.status,
          tr.assessor AS assessor
       FROM training_records tr
       JOIN people p ON p.person_id=tr.person_id
       JOIN courses c ON c.course_id=tr.course_id
       ${whereSQL}
       ORDER BY tr.completion_date DESC`,
      params
    );

    // 3rd‑party
    const third = await q(
      `SELECT
          t.cert_id AS training_record_id,
          p.display_name AS employee,
          p.email,
          t.title AS course,
          t.completion_date AS completed,
          t.expiry_date AS expires,
          CASE 
            WHEN t.expiry_date IS NULL THEN 'current'
            WHEN t.expiry_date >= CURDATE() THEN 'current'
            ELSE 'expired'
          END AS status,
          NULL AS assessor
       FROM third_party_certifications t
       JOIN people p ON p.person_id=t.person_id
       ORDER BY t.completion_date DESC`
    );

    res.json([...training, ...third]);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------
// CREATE TRAINING RECORD
// ------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({ storage });

app.post(
  "/api/records",
  requireAuth,
  upload.single("file"),
  allowSelfOrRoles(async (req) => {
    const [p] = await q(`SELECT person_id FROM people WHERE email=?`, [
      req.body.email,
    ]);
    return p?.person_id;
  }, "admin", "manager"),

  async (req, res, next) => {
    const { name, email, course_id, completion_date, notes, assessor } = req.body;
    const file = req.file;

    if (!name || !email || !course_id || !completion_date)
      return res.status(400).json({ error: "Missing required fields" });

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Upsert person
      await conn.query(
        `INSERT INTO people (display_name, email, is_active)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE display_name=VALUES(display_name)`,
        [name, email]
      );

      const [p] = await conn.query(
        `SELECT person_id FROM people WHERE email=?`,
        [email]
      );
      const person_id = p[0].person_id;

      const [ins] = await conn.query(
        `INSERT INTO training_records 
           (person_id, course_id, completion_date, notes, assessor)
         VALUES (?, ?, ?, ?, ?)`,
        [
          person_id,
          +course_id,
          completion_date,
          notes || null,
          assessor || null
        ]
      );

      if (file) {
        const rel = `/uploads/${file.filename}`;
        await conn.query(
          `INSERT INTO attachments 
             (training_record_id, file_name, file_path, mime_type)
           VALUES (?, ?, ?, ?)`,
          [ins.insertId, file.originalname, rel, file.mimetype]
        );
      }

      await conn.commit();
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      next(err);
    } finally {
      conn.release();
    }
  }
);

// ------------------------------------------------------
// EDIT TRAINING RECORD
// ------------------------------------------------------
app.put(
  "/api/records/:id",
  requireAuth,
  allowRoles("admin", "manager"),
  upload.single("file"),
  async (req, res, next) => {
    const id = Number(req.params.id);
    const { course_id, completion_date, notes, assessor } = req.body;
    const file = req.file;

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE training_records
         SET course_id=?, completion_date=?, notes=?, assessor=?
         WHERE training_record_id=?`,
        [
          course_id,
          completion_date,
          notes || null,
          assessor || null,
          id
        ]
      );

      if (file) {
        const rel = `/uploads/${file.filename}`;
        await conn.query(
          `INSERT INTO attachments 
             (training_record_id, file_name, file_path, mime_type)
           VALUES (?, ?, ?, ?)`,
          [id, file.originalname, rel, file.mimetype]
        );
      }

      await conn.commit();
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

// ------------------------------------------------------
// DELETE TRAINING RECORD
// ------------------------------------------------------
app.delete(
  "/api/records/:id",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    await q(`DELETE FROM training_records WHERE training_record_id=?`, [
      req.params.id,
    ]);
    res.json({ success: true });
  }
);

// ------------------------------------------------------
// One-time ICS download for ONE person (internal + third-party)
// ------------------------------------------------------
app.get(
  "/api/person/:id/export.ics",
  requireAuth,
  allowSelfOrRoles((req) => Number(req.params.id), "admin", "manager"),
  async (req, res, next) => {
    try {
      const personId = Number(req.params.id);

      const internal = await q(
        `SELECT 
           'internal' AS src,
           tr.training_record_id AS id,
           c.name AS title,
           tr.expiry_date AS expires
         FROM training_records tr
         JOIN courses c ON c.course_id = tr.course_id
         WHERE tr.person_id=? AND tr.expiry_date IS NOT NULL`,
        [personId]
      );

      const third = await q(
        `SELECT 
           'third' AS src,
           t.cert_id AS id,
           t.title AS title,
           t.expiry_date AS expires
         FROM third_party_certifications t
         WHERE t.person_id=? AND t.expiry_date IS NOT NULL`,
        [personId]
      );

      const rows = [...internal, ...third];

      const CRLF = "\r\n";
      const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const ymd = (d) => new Date(d).toISOString().slice(0,10).replace(/-/g,"");

      const out = [];
      out.push("BEGIN:VCALENDAR");
      out.push("PRODID:-//Training Manager//EN");
      out.push("VERSION:2.0");
      out.push("CALSCALE:GREGORIAN");
      out.push("METHOD:PUBLISH");

      for (const r of rows) {
        const start = ymd(r.expires);
        const e = new Date(r.expires); e.setDate(e.getDate() + 1);
        const end = ymd(e);
        const uid = `export-${personId}-${r.src}-${r.id}@your-domain`;

        out.push("BEGIN:VEVENT");
        out.push(`UID:${uid}`);
        out.push(`DTSTAMP:${dtstamp}`);
        out.push(`SUMMARY:Certificate expiry - ${r.title}`);
        out.push(`DTSTART;VALUE=DATE:${start}`);
        out.push(`DTEND;VALUE=DATE:${end}`);
        out.push("BEGIN:VALARM");
        out.push("ACTION:DISPLAY");
        out.push("DESCRIPTION:Certificate expiring soon");
        out.push("TRIGGER:-P14D");
        out.push("END:VALARM");
        out.push("END:VEVENT");
      }

      out.push("END:VCALENDAR");

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="cert-expiries-${personId}.ics"`);
      res.send(out.join(CRLF));
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// Subscribable iCal for ONE person (internal + third-party)
// ------------------------------------------------------
app.get(
  "/api/person/:id/calendar.ics",
  requireAuth,
  allowSelfOrRoles((req) => Number(req.params.id), "admin", "manager"),
  async (req, res, next) => {
    try {
      const personId = Number(req.params.id);

      const internal = await q(
        `SELECT 
           'internal' AS src,
           tr.training_record_id AS id,
           c.name AS title,
           tr.expiry_date AS expires
         FROM training_records tr
         JOIN courses c ON c.course_id = tr.course_id
         WHERE tr.person_id=? AND tr.expiry_date IS NOT NULL`,
        [personId]
      );

      const third = await q(
        `SELECT 
           'third' AS src,
           t.cert_id AS id,
           t.title AS title,
           t.expiry_date AS expires
         FROM third_party_certifications t
         WHERE t.person_id=? AND t.expiry_date IS NOT NULL`,
        [personId]
      );

      const rows = [...internal, ...third];

      const CRLF = "\r\n";
      const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const ymd = (d) => new Date(d).toISOString().slice(0,10).replace(/-/g,"");

      const out = [];
      out.push("BEGIN:VCALENDAR");
      out.push("PRODID:-//Training Manager//EN");
      out.push("VERSION:2.0");
      out.push("CALSCALE:GREGORIAN");
      out.push("METHOD:PUBLISH");

      for (const r of rows) {
        const start = ymd(r.expires);
        const e = new Date(r.expires); e.setDate(e.getDate() + 1);
        const end = ymd(e);
        const uid = `person-${personId}-${r.src}-${r.id}@your-domain`;

        out.push("BEGIN:VEVENT");
        out.push(`UID:${uid}`);
        out.push(`DTSTAMP:${dtstamp}`);
        out.push(`SUMMARY:Certificate expiry - ${r.title}`);
        out.push(`DTSTART;VALUE=DATE:${start}`);
        out.push(`DTEND;VALUE=DATE:${end}`);
        // VALARM must come AFTER VEVENT properties for New Outlook
        out.push("BEGIN:VALARM");
        out.push("ACTION:DISPLAY");
        out.push("DESCRIPTION:Certificate expiring soon");
        out.push("TRIGGER:-P14D");
        out.push("END:VALARM");
        out.push("END:VEVENT");
      }

      out.push("END:VCALENDAR");

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(out.join(CRLF));
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// 3RD-PARTY CERTIFICATIONS — same RBAC as training records
// ------------------------------------------------------

// Get list of third‑party certs for a person
app.get(
  "/api/thirdparty",
  requireAuth,
  allowSelfOrRoles((req) => Number(req.query.person_id), "admin", "manager"),
  async (req, res, next) => {
    const personId = Number(req.query.person_id);
    if (!personId) return res.status(400).json({ error: "person_id required" });

    try {
      const rows = await q(
        `SELECT 
            cert_id,
            person_id,
            title,
            provider,
            completion_date,
            expiry_date,
            notes,
            file_path,
            mime_type
         FROM third_party_certifications
         WHERE person_id=?
         ORDER BY completion_date DESC`,
        [personId]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

// Create a new 3rd‑party certification
app.post(
  "/api/thirdparty",
  requireAuth,
  upload.single("file"),
  allowSelfOrRoles((req) => Number(req.body.person_id), "admin", "manager"),
  async (req, res, next) => {
    const { person_id, title, provider, completion_date, expiry_date, notes } = req.body;
    const file = req.file;

    if (!person_id || !title || !provider || !completion_date)
      return res.status(400).json({ error: "Missing required fields" });

    let filePath = null;
    let mimeType = null;

    if (file) {
      filePath = `/uploads/${file.filename}`;
      mimeType = file.mimetype;
    }

    try {
      await q(
        `INSERT INTO third_party_certifications
           (person_id, title, provider, completion_date, expiry_date, notes, file_path, mime_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          person_id,
          title,
          provider,
          completion_date,
          expiry_date || null,
          notes || null,
          filePath,
          mimeType
        ]
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// Edit an existing 3rd‑party certification
app.put(
  "/api/thirdparty/:id",
  requireAuth,
  allowRoles("admin", "manager"),
  upload.single("file"),
  async (req, res, next) => {
    const certId = Number(req.params.id);
    const { title, provider, completion_date, expiry_date, notes } = req.body;
    const file = req.file;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE third_party_certifications
         SET title=?, provider=?, completion_date=?, expiry_date=?, notes=?
         WHERE cert_id=?`,
        [title, provider, completion_date, expiry_date || null, notes || null, certId]
      );

      if (file) {
        const filePath = `/uploads/${file.filename}`;
        await conn.query(
          `UPDATE third_party_certifications
           SET file_path=?, mime_type=?
           WHERE cert_id=?`,
          [filePath, file.mimetype, certId]
        );
      }

      await conn.commit();
      res.json({ success: true });

    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

// Delete a 3rd‑party certification
app.delete(
  "/api/thirdparty/:id",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    try {
      await q(
        `DELETE FROM third_party_certifications WHERE cert_id=?`,
        [req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// SINGLE 3RD-PARTY CERTIFICATE → ICS FILE
// ------------------------------------------------------
app.get(
  "/api/thirdparty/:id/ics",
  requireAuth,
  // owner/admin/manager can download
  allowSelfOrRoles(async (req) => {
    const certId = Number(req.params.id);
    const rows = await q(
      `SELECT person_id FROM third_party_certifications WHERE cert_id=? LIMIT 1`,
      [certId]
    );
    return rows[0]?.person_id;
  }, "admin", "manager"),
  async (req, res, next) => {
    try {
      const certId = Number(req.params.id);

      const rows = await q(
        `SELECT 
           t.cert_id,
           t.person_id,
           p.display_name AS employee,
           p.email,
           t.title,
           t.completion_date AS completed,
           t.expiry_date   AS expires
         FROM third_party_certifications t
         JOIN people p ON p.person_id = t.person_id
        WHERE t.cert_id = ?
        LIMIT 1`,
        [certId]
      );
      const row = rows[0];
      if (!row) return res.status(404).send("Not found");
      if (!row.expires) return res.status(400).send("Certificate has no expiry date");

      const uid     = `thirdparty-${row.cert_id}@training-system`;
      const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const ymd     = (d) => new Date(d).toISOString().slice(0,10).replace(/-/g, "");

      const start = ymd(row.expires);
      const endDt = new Date(row.expires); endDt.setDate(endDt.getDate() + 1);
      const end   = ymd(endDt);

      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "PRODID:-//Training Manager//EN",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `SUMMARY:Certificate expiry - ${row.title}`,
        `DESCRIPTION:${row.employee} (${row.email}) certificate expires`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Certificate expiring soon",
        "TRIGGER:-P14D",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n");

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="thirdparty-${row.cert_id}.ics"`
      );
      res.send(ics);
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// REPORTS — expiry-based (internal + 3rd‑party)
// ------------------------------------------------------
app.get(
  "/api/reports",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    const type = req.query.type || "all";
    const personId = Number(req.query.person_id || 0);

    const where = [];
    const params = [];

    // PERSON FILTER
    if (personId) {
      where.push("tr.person_id=?");
      params.push(personId);
    }

    // EXPIRY FILTERS (replaces old status-based logic)
    if (type === "valid") {
      where.push("(tr.expiry_date IS NULL OR tr.expiry_date >= CURDATE())");
    }

    if (type === "expiring") {
      where.push("tr.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)");
    }

    if (type === "expired") {
      where.push("tr.expiry_date < CURDATE()");
    }

    const wsql = where.length ? "WHERE " + where.join(" AND ") : "";

    try {
      /* ---------------------------
         INTERNAL TRAINING RECORDS
      ----------------------------*/
      const internal = await q(
        `SELECT
           p.display_name AS staff_name,
           p.email,
           c.name AS course,
           tr.completion_date AS completed,
           tr.expiry_date AS expires,
           tr.assessor AS assessor,
           CASE
             WHEN tr.expiry_date IS NULL THEN 'current'
             WHEN tr.expiry_date < CURDATE() THEN 'expired'
             WHEN tr.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
               THEN 'expiring_soon'
             ELSE 'current'
           END AS status
         FROM training_records tr
         JOIN people p ON p.person_id = tr.person_id
         JOIN courses c ON c.course_id = tr.course_id
         ${wsql}
         ORDER BY p.display_name, c.name`,
        params
      );

      /* ---------------------------
         THIRD-PARTY CERTIFICATIONS
         Must apply expiry filters manually
      ----------------------------*/
      let tpWhere = [];
      let tpParams = [];

      if (personId) {
        tpWhere.push("t.person_id=?");
        tpParams.push(personId);
      }

      if (type === "valid") {
        tpWhere.push("(t.expiry_date IS NULL OR t.expiry_date >= CURDATE())");
      }

      if (type === "expiring") {
        tpWhere.push("t.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)");
      }

      if (type === "expired") {
        tpWhere.push("t.expiry_date < CURDATE()");
      }

      const tpSQL = tpWhere.length ? "WHERE " + tpWhere.join(" AND ") : "";

      const third = await q(
        `SELECT
           p.display_name AS staff_name,
           p.email,
           t.title AS course,
           t.completion_date AS completed,
           t.expiry_date AS expires,
           NULL AS assessor,
           CASE 
             WHEN t.expiry_date IS NULL THEN 'current'
             WHEN t.expiry_date < CURDATE() THEN 'expired'
             WHEN t.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
               THEN 'expiring_soon'
             ELSE 'current'
           END AS status
         FROM third_party_certifications t
         JOIN people p ON p.person_id = t.person_id
         ${tpSQL}
         ORDER BY p.display_name, t.title`,
        tpParams
      );

      /* ---------------------------
         MERGE INTERNAL + THIRD-PARTY
      ----------------------------*/
      res.json([...internal, ...third]);
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// Expiring
// ------------------------------------------------------
app.get("/api/expiring", requireAuth, async (req, res, next) => {
  try {
    const upcomingInternal = await q(
      `SELECT 
          p.display_name AS employee,
          p.email,
          c.name AS course,
          tr.expiry_date
       FROM training_records tr
       JOIN people p ON p.person_id = tr.person_id
       JOIN courses c ON c.course_id = tr.course_id
       WHERE tr.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
       ORDER BY tr.expiry_date ASC`
    );

    const upcomingTP = await q(
      `SELECT
          p.display_name AS employee,
          p.email,
          t.title AS course,
          t.expiry_date
       FROM third_party_certifications t
       JOIN people p ON p.person_id = t.person_id
       WHERE t.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
       ORDER BY t.expiry_date ASC`
    );

    res.json([...upcomingInternal, ...upcomingTP]);
  } catch (err) {
    next(err);
  }
});
// ------------------------------------------------------
// MY TRAINING  (training + 3rd‑party)
// ------------------------------------------------------
app.get("/api/my", requireAuth, async (req, res, next) => {
  const me = req.session.user;

  if (req.query.person_id && Number(req.query.person_id) !== me.person_id)
    return res.status(403).json({ error: "Forbidden" });

  try {
    // Internal training records
    const training = await q(
      `SELECT 
         c.name AS course,
         tr.completion_date AS completed,
         tr.expiry_date AS expires,
         tr.assessor AS assessor,
         CASE
           WHEN tr.expiry_date IS NULL THEN 'current'
           WHEN tr.expiry_date < CURDATE() THEN 'expired'
           WHEN tr.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
             THEN 'expiring_soon'
           ELSE 'current'
         END AS status
       FROM training_records tr
       JOIN courses c ON c.course_id = tr.course_id
       WHERE tr.person_id=?
       ORDER BY tr.completion_date DESC`,
      [me.person_id]
    );

    // 3rd party certifications
    const thirdparty = await q(
      `SELECT 
         title AS course,
         completion_date AS completed,
         expiry_date AS expires,
         NULL AS assessor,
         CASE 
           WHEN expiry_date IS NULL THEN 'current'
           WHEN expiry_date < CURDATE() THEN 'expired'
           WHEN expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
             THEN 'expiring_soon'
           ELSE 'current'
         END AS status
       FROM third_party_certifications
       WHERE person_id=?
       ORDER BY completion_date DESC`,
      [me.person_id]
    );

    // Combine lists
    const list = [...training, ...thirdparty].sort(
      (a, b) => new Date(b.completed) - new Date(a.completed)
    );

    // Count internal
    const [internalCounts] = await q(
      `SELECT 
          COUNT(*) AS total,
          SUM(status='current') AS current,
          SUM(status='expiring_soon') AS expiring_soon,
          SUM(status='expired') AS expired
       FROM (
         SELECT 
           CASE
             WHEN expiry_date IS NULL THEN 'current'
             WHEN expiry_date < CURDATE() THEN 'expired'
             WHEN expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
               THEN 'expiring_soon'
             ELSE 'current'
           END AS status
         FROM training_records
         WHERE person_id=?
       ) AS s`,
      [me.person_id]
    );

    // Count third party
    const [tpCounts] = await q(
      `SELECT 
          COUNT(*) AS total,
          SUM(expiry_date IS NULL OR expiry_date >= CURDATE()) AS current,
          SUM(expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)) AS expiring_soon,
          SUM(expiry_date < CURDATE()) AS expired
       FROM third_party_certifications
       WHERE person_id=?`,
      [me.person_id]
    );

    // Combine (fix null values using safe default 0)
    const counts = {
      total: Number(internalCounts.total || 0) + Number(tpCounts.total || 0),
      current: Number(internalCounts.current || 0) + Number(tpCounts.current || 0),
      expiring_soon: Number(internalCounts.expiring_soon || 0) + Number(tpCounts.expiring_soon || 0),
      expired: Number(internalCounts.expired || 0) + Number(tpCounts.expired || 0)
    };

    res.json({ list, counts });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------
// GET ONE RECORD
// ------------------------------------------------------
// Get a single training record by ID — admin/manager only
app.get(
  "/api/records/:id",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const rows = await q(
        `SELECT 
            training_record_id,
            person_id,
            course_id,
            completion_date,
            expiry_date,
            notes,
            assessor
         FROM training_records
         WHERE training_record_id = ? 
         LIMIT 1`,
        [id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Not found" });
      }

      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// ADMIN: Update a person's role
// ------------------------------------------------------
app.put(
  "/api/people/:id/role",
  requireAuth,
  allowRoles("admin"),   // Only admins can change roles
  async (req, res, next) => {
    const personId = Number(req.params.id);
    const { role } = req.body;

    if (!["admin", "manager", "user"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    try {
      // Update the user record linked to this person
      await q(
        `UPDATE users SET role=? WHERE person_id=?`,
        [role, personId]
      );

      res.json({ success: true, role });
    } catch (err) {
      next(err);
    }
  }
);

// ------------------------------------------------------
// EXPORT ALL CERTIFICATE EXPIRIES (internal + 3rd-party)
// ------------------------------------------------------
app.get(
  "/api/person/:id/export.ics",
  requireAuth,
  allowSelfOrRoles((req) => Number(req.params.id), "admin", "manager"),
  async (req, res, next) => {
    try {
      const personId = Number(req.params.id);

      const internal = await q(
        `SELECT 
           'internal' AS src,
           tr.training_record_id AS id,
           c.name AS title,
           tr.expiry_date AS expires
         FROM training_records tr
         JOIN courses c ON c.course_id = tr.course_id
         WHERE tr.person_id=? AND tr.expiry_date IS NOT NULL`,
        [personId]
      );

      const third = await q(
        `SELECT 
           'third' AS src,
           t.cert_id AS id,
           t.title AS title,
           t.expiry_date AS expires
         FROM third_party_certifications t
         WHERE t.person_id=? AND t.expiry_date IS NOT NULL`,
        [personId]
      );

      const rows = [...internal, ...third];

      const CRLF = "\r\n";
      const dtstamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
      const ymd = (d) =>
        new Date(d).toISOString().slice(0, 10).replace(/-/g, "");

      const out = [];
      out.push("BEGIN:VCALENDAR");
      out.push("PRODID:-//Training Manager//EN");
      out.push("VERSION:2.0");
      out.push("CALSCALE:GREGORIAN");
      out.push("METHOD:PUBLISH");

      for (const r of rows) {
        const start = ymd(r.expires);
        const e = new Date(r.expires);
        e.setDate(e.getDate() + 1);
        const end = ymd(e);
        const uid = `export-${personId}-${r.src}-${r.id}@your-domain`;

        out.push("BEGIN:VEVENT");
        out.push(`UID:${uid}`);
        out.push(`DTSTAMP:${dtstamp}`);
        out.push(`SUMMARY:Certificate expiry - ${r.title}`);
        out.push(`DTSTART;VALUE=DATE:${start}`);
        out.push(`DTEND;VALUE=DATE:${end}`);
        out.push("BEGIN:VALARM");
        out.push("ACTION:DISPLAY");
        out.push("DESCRIPTION:Certificate expiring soon");
        out.push("TRIGGER:-P14D");
        out.push("END:VALARM");
        out.push("END:VEVENT");
      }

      out.push("END:VCALENDAR");

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="cert-expiries-${personId}.ics"`
      );
      res.send(out.join(CRLF));
    } catch (err) {
      next(err);
    }
  }
);

// View a single course and its training records — any authenticated user
app.get("/api/course/:id/details", requireAuth, async (req, res, next) => {
  try {
    const courseId = Number(req.params.id);

    const [course] = await q(
  `SELECT 
      c.course_id,
      c.name,
      c.description,
      c.type,
      c.validity_days,
      cat.name AS category,
      prov.name AS provider
   FROM courses c
   LEFT JOIN categories cat ON cat.category_id = c.category_id
   LEFT JOIN providers  prov ON prov.provider_id = c.provider_id
   WHERE c.course_id=?`,
  [courseId]
);

    if (!course) return res.status(404).json({ error: "Course not found" });

    const records = await q(
      `SELECT 
          tr.training_record_id,
          p.display_name AS person,
          tr.completion_date AS completed,
          tr.expiry_date AS expires,
          CASE
            WHEN tr.expiry_date IS NULL THEN 'current'
            WHEN tr.expiry_date < CURDATE() THEN 'expired'
            WHEN tr.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
              THEN 'expiring_soon'
            ELSE 'current'
          END AS status
       FROM training_records tr
       JOIN people p ON p.person_id = tr.person_id
       WHERE tr.course_id=?
       ORDER BY tr.completion_date DESC`,
      [courseId]
    );

    res.json({ course, records });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------
// Global Error Handler
// ------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Server error", detail: err.message });
});

// ------------------------------------------------------
// Start Server
// ------------------------------------------------------
app.listen(PORT, () => {
  console.log(`API + Frontend listening on http://127.0.0.1:${PORT}`);
});

app.put(
  "/api/courses/:id",
  requireAuth,
  allowRoles("admin", "manager"),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { name, description, type, providerName, validityDays } = req.body;

      await q(
        `UPDATE courses
         SET name=?, description=?, type=?, provider_id=(
            SELECT provider_id FROM providers WHERE name=? LIMIT 1
         ), validity_days=?
         WHERE course_id=?`,
        [name, description, type, providerName || null, validityDays || null, id]
      );

      res.json({ success: true });

    } catch (err) {
      next(err);
    }
  }
);