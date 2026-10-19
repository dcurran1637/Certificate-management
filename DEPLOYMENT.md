# Production Deployment Runbook

This runbook deploys the app to an Ubuntu VPS with MySQL, systemd, and Nginx.
The app serves its frontend from `public/` and its API from the same origin.
Keep port 5000 private; expose only HTTPS through the reverse proxy.

## 1. Prepare the host

Install Node.js 20 or newer, npm, MySQL 8.0 or newer (unless using a managed
database), Nginx, and Git. Create a dedicated service account and directories:

```sh
sudo adduser --system --group --home /opt/certapp certapp
sudo install -d -o root -g certapp -m 0750 /opt/certapp/app
sudo install -d -o certapp -g certapp -m 0750 /var/lib/certapp/uploads
```

Place the application files in `/opt/certapp/app`, including `package-lock.json`,
then install locked dependencies:

```sh
cd /opt/certapp/app
npm ci --omit=dev
```

The repository currently has no separate build step.

## 2. Create the database

For a local MySQL server, apply both schemas in this order:

```sh
sudo mysql < "Database schema.sql"
sudo mysql < "Session schema.sql"
```

The database name in the SQL is `certapp`; set `DB_NAME=certapp`. The schema
creates a local app account named `certapp_app` with data-only privileges. Set
its password to a unique secret and use the same value for `DB_PASSWORD`.

For managed/remote MySQL, create the database, app account, and grants using
the provider's controls. Grant only `SELECT`, `INSERT`, `UPDATE`, and `DELETE`
on the app database. Apply both schema files to that database, omitting the
local `CREATE USER`/`ALTER USER`/`GRANT` statements in `Database schema.sql`.
Save the database provider's CA certificate on the host; `DB_SSL_CA` must point
to that file. Remote production databases are rejected at startup without it.

## 3. Configure the application

Create `/etc/certapp.env` as root with mode `0640` and group `certapp`:

```sh
sudo install -o root -g certapp -m 0640 /dev/null /etc/certapp.env
sudoedit /etc/certapp.env
```

Set these values, replacing the examples. `APP_ORIGIN` must be the public HTTPS
origin exactly, with no path or trailing slash.

```dotenv
NODE_ENV=production
PORT=5000
APP_ORIGIN=https://certificates.example.com
DB_HOST=localhost
DB_PORT=3306
DB_USER=certapp_app
DB_PASSWORD=replace-with-a-unique-database-secret
DB_NAME=certapp
SESSION_SECRET=replace-with-a-long-random-secret
UPLOAD_DIR=/var/lib/certapp/uploads
```

For a remote database, set `DB_HOST` to its hostname and `DB_SSL_CA` to the
absolute path of its CA certificate. Generate a session secret with:

```sh
openssl rand -base64 48
```

Never commit the environment file or put secrets in the application directory.
The application issues a session-bound CSRF token and requires it on every
state-changing request, including login and invite-based registration. The
browser obtains and sends this token automatically; keep the existing
same-origin `APP_ORIGIN` configuration because the origin check remains an
additional defense.

## 4. Install the systemd service

Create `/etc/systemd/system/certapp.service`:

```ini
[Unit]
Description=Certificate Management App
After=network.target

[Service]
Type=simple
User=certapp
Group=certapp
WorkingDirectory=/opt/certapp/app
EnvironmentFile=/etc/certapp.env
ExecStart=/usr/bin/node /opt/certapp/app/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/certapp/uploads

[Install]
WantedBy=multi-user.target
```

If Node is installed somewhere other than `/usr/bin/node`, update `ExecStart`
to the result of `command -v node`. Then start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now certapp
sudo systemctl status certapp --no-pager
sudo journalctl -u certapp -n 100 --no-pager
```

## 5. Configure HTTPS and the firewall

Point the domain's DNS A/AAAA records at the host. Configure Nginx with a valid
TLS certificate and a site such as:

```nginx
server {
    listen 80;
    server_name certificates.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name certificates.example.com;

    # Configure ssl_certificate and ssl_certificate_key for your TLS provider.

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }
}
```

Install/renew the certificate using your TLS provider, validate and reload
Nginx (`sudo nginx -t && sudo systemctl reload nginx`), and allow inbound
ports 80/443 plus SSH in the host/provider firewall. Do not allow public access
to port 5000 or MySQL port 3306. The app trusts one reverse proxy and requires
the proxy to report HTTPS.

## 6. Create the first administrator

Registration is invite-only, and creating invites requires an administrator.
There is no bootstrap-admin command. Create the first admin through a controlled
database operation after the schema is installed.

Generate a bcrypt hash locally without putting the password in shell history:

```sh
read -rsp "Initial admin password: " INITIAL_ADMIN_PASSWORD; printf '\n'
INITIAL_ADMIN_HASH=$(INITIAL_ADMIN_PASSWORD="$INITIAL_ADMIN_PASSWORD" node -e 'require("bcrypt").hash(process.env.INITIAL_ADMIN_PASSWORD, 10).then(console.log)')
unset INITIAL_ADMIN_PASSWORD
printf '%s\n' "$INITIAL_ADMIN_HASH"
```

In a MySQL session for `certapp`, create the matching person and admin account.
Substitute the actual name, email, and printed bcrypt hash. Use the same email
for both rows, and protect/clear the hash after the operation.

```sql
START TRANSACTION;
INSERT INTO people (display_name, email, is_active)
VALUES ('Initial Administrator', 'admin@example.com', 1);
SET @person_id = LAST_INSERT_ID();
INSERT INTO users (email, username, password_hash, role, person_id)
VALUES ('admin@example.com', 'admin', '<BCRYPT_HASH>', 'admin', @person_id);
COMMIT;
```

Unset the temporary shell variable with `unset INITIAL_ADMIN_HASH`, then sign
in over HTTPS. Use the admin interface/API to issue invitations; verify each
invite goes only to the intended person. Do not create a publicly exposed
registration path.

## 7. Verify and hand over

Open `https://certificates.example.com`, sign in as the initial admin, and
verify an invite/registration flow with a test account. Confirm uploaded files
persist under `/var/lib/certapp/uploads`, sessions survive an app restart, and
there are no database/TLS errors in `journalctl -u certapp`.

Run `npm test` before each release. Back up the MySQL database and upload
directory together, restrict backup access, and test restoration. Keep OS,
Node.js, MySQL, Nginx, and npm dependencies patched. To deploy an application
update, back up first, update the files, run `npm ci --omit=dev`, then
`sudo systemctl restart certapp` and repeat the smoke checks. If startup fails,
inspect `journalctl -u certapp` and restore the previous application release.
