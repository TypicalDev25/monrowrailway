# Finance Management System

Full-stack financial management system with React frontend and Express backend.

## Features

- **Authentication**: Admin and Employee roles
- **Budget Proposals**: Employees submit proposals, admins approve/reject
- **Transactions**: Track budgets, expenses, and income
- **Dashboard**: Admin summary with monthly filters

## Quick Start

**Windows:** Double-click `START.bat`  
**Mac/Linux:** Run `./START.sh`

Or manually:

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

Default admin: `admin` / `admin123`

## Tech Stack

- Frontend: React + Vite
- Backend: Express + SQLite
- Authentication: JWT

## Environment Variables

**Backend:**
- `FRONTEND_URL` - Frontend URL for CORS
- `JWT_SECRET` - Secret key for JWT tokens
- `PORT` - Server port (default: 4000)

**Frontend:**
- `VITE_API_URL` - Backend API URL (default: http://localhost:4000/api)
