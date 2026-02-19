Technology Stack
Backend

Node.js
Express.js
MySQL
express-session
bcrypt
multer (file uploads)

Frontend

HTML
Vanilla JavaScript
Bootstrap 5
Bootstrap Icons
SPA routing (hash-based)

Features
Authentication and Roles

Login and logout implemented with session cookies
Role system with three levels:

User – Can manage their own training only
Manager – Can manage training for all people
Admin – Can manage roles, training, people, and system-wide data



Internal Training Records

Add internal training records
Edit and update records
Upload evidence files
Automatic expiry calculation based on course validity
Display training status: current, expiring soon, expired

Third‑Party Certifications

Add third‑party certificates
Edit and update
Upload evidence
Track expiry dates
Display separately in the profile but included in ICS feeds and reports

ICS Calendar Integration
The system provides:


Subscription ICS Feed
Accessible at:
/api/person/:id/calendar.ics
Outlook and other calendar applications can subscribe to this feed to automatically receive updates.


Download All Expiry Dates as ICS
Accessible at:
/api/person/:id/export.ics


Individual Record ICS Files

/api/records/:id/ics
/api/thirdparty/:id/ics



All ICS files follow proper iCalendar standards, including alarms, all‑day events, and CRLF formatting.
Dashboards

Total staff
Active courses
Expiring soon
Current certifications
Upcoming expiries list

My Training

Lists all training and certification records for the logged‑in user
Shows totals and summary
Includes ICS subscription and export buttons

Person Profile

Shows internal training records
Shows third‑party certs
Admin can change user roles
Admin and manager can add/edit/delete
Includes ICS subscription/download buttons

Reports

Filter by person
Filter by expired, expiring soon, valid, all
Export results to CSV
Displays combined internal + third‑party records


Project Structure
root/
│ server.js
│ package.json
│ .env
│ uploads/                # certificate files
│ mysql-data/             # database volume if using Docker
│
└── public/
    ├── index.html
    ├── Login.html
    ├── app.js
    ├── auth.js
    ├── styles.css
    └── uploads/          # public evidence storage


Environment Variables
Create .env:
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASS=yourpassword
DB_NAME=training_manager
SESSION_SECRET=something_secret
UPLOAD_DIR=uploads


Installation

Install dependencies:

npm install


Start the server:

node server.js


Open the application:

http://localhost:5000


Database
You must set up the following tables:

users
people
courses
training_records
third_party_certifications
attachments
providers (optional)
categories (optional)

The server will not create tables automatically.

Role Management
Admins can assign roles from the Person Profile window.
Changes take effect immediately.

ICS Notes
ICS output follows:

RFC 5545 standard
All‑day events using VALUE=DATE
Next‑day DTEND for all‑day events
VALARM placed after VEVENT properties
CRLF line endings
Unique and stable UID values

Compatible with Outlook, Apple Calendar, and Google Calendar.

Security

Sessions implemented using httpOnly cookies
Role checks on all API routes
Users cannot modify or view another user’s training
Admin‑only actions for sensitive operations
File uploads validated and stored in controlled directories

Ensure:

/uploads directory is writable
The MySQL credentials in .env match your server
Reverse proxies forward cookies correctly