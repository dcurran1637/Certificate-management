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

# Optional (but recommended)
mkdir -p uploads