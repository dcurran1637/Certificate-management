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

### Optional: phpMyAdmin for local database administration

For a local MySQL server, phpMyAdmin can be run in a Docker container using the
host's MySQL service. Keep its web port blocked from the public internet and
access it through an SSH tunnel. Do not add a public Nginx route for phpMyAdmin.
For managed databases, use the provider's administration tools or a private
VPN/tunnel instead of exposing phpMyAdmin publicly.

Install Docker, then create a private environment file for phpMyAdmin's cookie
encryption secret:

```sh
sudo install -o root -g root -m 0600 /dev/null /etc/phpmyadmin.env
printf 'PMA_BLOWFISH_SECRET=%s\n' "$(openssl rand -hex 32)" |
  sudo tee /etc/phpmyadmin.env >/dev/null
```

Run phpMyAdmin on the host network so it can reach MySQL bound to localhost.
The image listens on port 8080; cookie authentication prompts for a MySQL
username and password rather than storing database credentials in the
container:

```sh
sudo docker run -d \
  --name certapp-phpmyadmin \
  --restart unless-stopped \
  --network host \
  --env-file /etc/phpmyadmin.env \
  -e PMA_HOST=127.0.0.1 \
  -e PMA_PORT=3306 \
  -e APACHE_PORT=8080 \
  -e PMA_ARBITRARY=0 \
  phpmyadmin:5-apache
```

Block inbound access to port 8080 in both the host and cloud firewalls. For
UFW, for example:

```sh
sudo ufw deny 8080/tcp
```

From your workstation, open an SSH tunnel to the server:

```sh
ssh -N -L 8080:127.0.0.1:8080 <SSH_USER>@<SERVER_HOST>
```

While the tunnel is running, browse to `http://127.0.0.1:8080` and sign in
with a MySQL account. The application's `certapp_app` account is limited to
data operations on `certapp`; use a separately managed, least-privilege
database administrator account only when schema administration is required.
Never grant administrative privileges to the application's account. To stop
phpMyAdmin when it is not needed, run `sudo docker stop certapp-phpmyadmin`.

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
# Replace with the name, email, and password you will use to sign in.
BOOTSTRAP_ADMIN_NAME=Your Name
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=REPLACE_WITH_YOUR_UNIQUE_PASSWORD
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

The three `BOOTSTRAP_ADMIN_*` values are used only when the database has no
administrator. Replace the examples with the name and email you want on the
admin account, plus a unique password of at least 12 characters. You will sign
in with this email and password, so save the password in your password manager.
Choose an email not already attached to a user account. Protect the environment
file as shown above.

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

## 6. Create the first administrator and issue invitations

On the first startup, the app checks for an administrator. If none exists and
all three `BOOTSTRAP_ADMIN_*` values are configured, it creates the matching
person and admin account in one database transaction and stores the password
as a bcrypt hash. It uses a database lock to prevent two app instances from
creating competing bootstrap accounts. No default password is stored in the
schema. Existing administrator accounts are never changed by this process.

```sh
sudo systemctl start certapp
sudo journalctl -u certapp -n 50 --no-pager
```

Confirm the log says the bootstrap administrator was created, then immediately
remove the three `BOOTSTRAP_ADMIN_*` entries from `/etc/certapp.env` and restart
the service so the password is no longer present in its configuration file:

```sh
sudoedit /etc/certapp.env
sudo systemctl restart certapp
```

Sign in over HTTPS with the configured email and password. From the People
page, use **Invite person** to create registration invitations. Verify each
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
