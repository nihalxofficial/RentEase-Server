# RentEase — Property Rental & Booking Platform (Server)

This repository contains the **backend (server-side)** codebase for RentEase — a full-stack property rental and booking platform. The server provides a secure REST API consumed by the Next.js frontend, handling authentication, property management, bookings, payments and admin operations.

🌐 **Live URL:** [https://rentease-flash.vercel.app](https://rentease-flash.vercel.app)

📁 **Client Repository:** [https://github.com/nihalxofficial/RentEase-Client](https://github.com/nihalxofficial/RentEase-Client)

---

## Key Features

### Authentication & Security
- JWT token generated on login and verified on every protected endpoint
- Role-based middleware protecting all routes (Tenant, Owner, Admin)
- Google OAuth role auto-assignment (Tenant by default)
- Passwords hashed securely before storage
- Environment variables used for all secrets — no credentials in source code

### Property Management
- CRUD operations for properties (Owner scoped)
- Admin can Approve, Reject (with feedback text), Update, or Delete any property
- Only approved properties appear on public-facing pages
- Property status flow: Pending → Approved / Rejected
- Rejection feedback stored and retrievable by Owner

### Search, Filter & Sort (Backend)
- Search properties by Location
- Filter properties by Property Type
- Sort properties by Price (Low→High / High→Low)
- All logic handled server-side — no client-side filtering

### Booking System
- Booking creation tied to Stripe payment success
- Booking status management: Pending → Approved / Rejected (Owner action)
- Owner can approve or reject individual booking requests
- Admin can monitor all platform-wide bookings

### Payments & Transactions
- Stripe webhook or intent handling for secure payment confirmation
- Transaction records stored with: Transaction ID, Property, Tenant, Owner, Amount, Date
- Owner earnings calculated from successful payment records
- Monthly earnings aggregation (last 12 months) for dashboard charts

### Favourites & Reviews
- Tenants can save/remove properties from favourites (stored per user in DB)
- Reviews stored with: star rating, comment, user info, timestamp
- Only approved tenants with bookings can submit reviews

### Admin Controls
- Full user table with role change capability
- Full property moderation with rejection feedback modal
- Platform-wide bookings and transactions visibility

### Pagination
- Implemented on at least 2 routes (e.g. All Properties, All Bookings)
- Backend returns paginated results with total count for frontend controls

---

## Tech Stack

| Package | Purpose |
|---|---|
| `express` | Web server and REST API routing framework |
| `mongodb` | Official MongoDB driver for database operations |
| `mongodb atlas` | Cloud-hosted MongoDB database service |
| `dotenv` | Loads environment variables from `.env` into `process.env` |
| `cors` | Enables cross-origin requests from the frontend |
| `nodemon` | Auto-restarts the server on file changes during development |
| `jsonwebtoken` | Signs and verifies JWT tokens for authentication |
| `jose-cjs` | JWT verification and signing with modern JOSE standards |
| `stripe` | Server-side Stripe SDK for payment intent and transaction handling |

---

## Environment Variables

Create a `.env` file in the project root:

```env
PORT=5000
MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_jwt_secret_key
STRIPE_SECRET_KEY=your_stripe_secret_key
CLIENT_URL=https://rentease-flash.vercel.app
```

> Never commit `.env` to version control.

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/nihalxofficial/RentEase-Server.git
cd RentEase-Server

# Install dependencies
npm install

# Start development server
npm run dev
```

The server runs on [http://localhost:5000](http://localhost:5000) by default.

---

## Deployment Notes

- Server deployed without CORS, 404, or 504 errors in production
- All private routes reload correctly without session loss
- MongoDB Atlas used for cloud database hosting
- Stripe webhooks configured for reliable payment confirmation