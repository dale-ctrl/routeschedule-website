# Route Schedule — Truck Route Scheduling System

A professional route scheduling and management system for 12-ton DAF truck fleets.

## Features

- **📦 Order Management** — Import orders from CSV or Excel files (customer, postcode, weight)
- **🗺️ Google Maps Routing** — Real journey times via Google Maps Directions API
- **⚡ Rules Engine** — Configurable rules to automatically assign orders to days, set priorities, and more
- **🚛 Fleet Management** — Track your 12T DAF trucks with payload capacities
- **📅 Schedule View** — Weekly calendar showing routes per day
- **🔧 Route Generation** — Automatically bin-packs orders into trucks respecting weight limits, then optimises stop order

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in your Google Maps API key:

```bash
cp .env.example .env
```

Required APIs (enable in [Google Cloud Console](https://console.cloud.google.com)):
- Maps JavaScript API
- Directions API
- Geocoding API
- Distance Matrix API

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## CSV Import Format

The system accepts CSV or Excel files with these columns (column names are flexible):

| Column | Aliases | Required |
|--------|---------|----------|
| Customer | Company, Name | Yes |
| Postcode | Post Code, Zip | Yes |
| Weight (kg) | Weight, KG | Yes |
| Reference | Ref, Order Number, PO | No |
| Address | Delivery Address | No |
| Notes | Comments | No |
| Area | Region, Zone | No |
| Delivery Time | Time, AM/PM | No |

## Rules Engine

Rules are applied automatically during import. Each rule has:

- **Conditions** — e.g. `postcode starts_with "SW"` or `area equals "WG AREA"`
- **Actions** — e.g. `assign_day → monday` or `set_priority → 5`

Example rules:
- WG AREA → Monday
- SW1 postcodes → Wednesday
- Schools (customer contains "School") → AM delivery
- Heavy orders (weight > 500kg) → priority 8

## Truck Fleet

Default configuration: 12T DAF trucks with 7,500kg payload capacity.
Configurable per truck in the Fleet section.

## Tech Stack

- **Next.js 16** (App Router)
- **Prisma 7** with SQLite (via better-sqlite3)
- **Google Maps APIs** (Directions, Geocoding)
- **Tailwind CSS**
- **TypeScript**
