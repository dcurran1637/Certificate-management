# Local installation

Requirements: Node.js 20 or newer and MySQL 8.0 or newer.

1. Install dependencies from the project root:

  ```sh
  npm ci
  ```

2. Make a permission-restricted temporary copy of `Database schema.sql` and
  replace `<ROTATED_SECRET>` in that copy with a unique MySQL password. Apply
  the temporary copy, then delete it. The checked-in schema creates a database
  named `certapp` and a local-only MySQL app user:

  ```sh
  schema_copy=$(mktemp)
  chmod 600 "$schema_copy"
  cp "Database schema.sql" "$schema_copy"
  nano "$schema_copy"
  sudo mysql < "$schema_copy"
  sudo mysql < "Session schema.sql"
  rm -f "$schema_copy"
  ```

3. Copy `.env.example` to `.env`. Set `DB_NAME=certapp`, set `DB_PASSWORD` to
  the same secret used in the temporary SQL copy, and set a long random
  `SESSION_SECRET`. Keep `.env` private and out of source control.

4. Start the app and open http://127.0.0.1:5000:

  ```sh
  npm start
  ```

5. Run the test suite with `npm test`.

For a public production deployment, use [DEPLOYMENT.md](DEPLOYMENT.md). It
covers HTTPS, persistent sessions, uploads, and first-admin setup. The
`init-db` package script refers to a file that is not included; use the SQL
schema files above instead.