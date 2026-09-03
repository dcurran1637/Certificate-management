# Ensure system is updated
sudo apt update

# Install Node.js + npm
sudo apt install -y nodejs npm

# Install MySQL Server
sudo apt install -y mysql-server

# Install required Node backend packages
npm install \
  express \
  express-session \
  mysql2 \
  multer \
  bcrypt \
  dotenv

# Production requirements
# 1. Create certapp_app with a unique secret and grant only SELECT/INSERT/UPDATE/DELETE
#    as shown in Database schema.sql. Rotate the old certadmin/password123 credential.
# 2. Set DB_PASSWORD to that rotated secret and keep it out of source control.
# 3. Store uploads outside the public web root (for example /var/lib/certapp/uploads).
# 4. Terminate HTTPS at the reverse proxy/load balancer and proxy to this Node process.
#    Set NODE_ENV=production; the app then sets secure session cookies and trusts one proxy.
# 5. Use a long random SESSION_SECRET.