# Railway Deployment Guide

## Setup Steps

### 1. Prerequisites
- GitHub account (Railway deploys from Git)
- Railway account (free tier available at railway.app)
- Your repository pushed to GitHub

### 2. Connect to Railway

1. Go to [railway.app](https://railway.app)
2. Sign in with GitHub
3. Click **"New Project"** → **"Deploy from GitHub repo"**
4. Select your repository
5. Railway will auto-detect Node.js and start building

### 3. Configure Environment Variables

In Railway dashboard:
1. Go to your **Project** → **Variables** tab
2. Add these variables:

```
JWT_SECRET=generate-a-strong-random-key-here
PORT=4000
FRONTEND_URL=https://your-app.up.railway.app
```

**Important:** 
- Change `JWT_SECRET` to a strong random string (use `openssl rand -hex 32`)
- `FRONTEND_URL` will be auto-assigned by Railway after first deployment
- Update it in the Variables tab after you see the deployed URL

### 4. Database Persistence (SQLite Volume)

SQLite database file needs to persist across deployments:

1. In Railway dashboard → your app → **Volumes** tab
2. Click **"Create Volume"**
3. Set:
   - **Source Path:** `/app/backend/database.sqlite`
   - **Mount Path:** `/app/backend/database.sqlite`
4. This ensures database isn't lost on redeploy

### 5. Deployment

Railway auto-deploys when you push to GitHub:
- It runs: `npm run build` (builds frontend, installs backend)
- Then: `npm start` (starts backend on PORT, serves frontend)

### 6. Access Your App

After deployment completes:
- Go to your Railway project URL (e.g., `https://finance-app.up.railway.app`)
- Login with: `admin` / `admin123`
- Update `FRONTEND_URL` in Variables if needed

## Local Testing Before Deploy

Test the build locally to catch issues early:

```bash
# Build frontend
cd frontend
npm install
npm run build

# Start backend (serves frontend)
cd ../backend
npm install
PORT=4000 npm start

# Open http://localhost:4000
```

## Troubleshooting

### Build fails
- Check Railway logs: Project → Deployments → click failed build
- Ensure `frontend/dist/` builds locally: `cd frontend && npm run build`

### Database lost after deploy
- Ensure Volume is created and mounted to `/app/backend/database.sqlite`
- Check Railway Volumes tab

### API calls return 404
- Ensure `FRONTEND_URL` is set in Variables
- Check that backend is serving `/api` routes before static files

### Login page doesn't load
- Frontend build must complete successfully
- Check that `/frontend/dist/index.html` exists in logs

## Production Checklist

- [ ] Changed `JWT_SECRET` to strong random key
- [ ] Set `FRONTEND_URL` to your Railway URL
- [ ] Created SQLite volume
- [ ] Tested login with admin/admin123
- [ ] Tested a full workflow (proposal creation, approval)
- [ ] Changed admin password from default

## Scale for Production

- **Database:** Consider migrating from SQLite to PostgreSQL
  - Railway offers managed PostgreSQL
  - Update backend to use `pg` package
  
- **Monitoring:** Enable Railway notifications
- **Backups:** Set up automatic backups if using PostgreSQL

## Support

Railway docs: https://docs.railway.app/
For issues, check Railway logs and GitHub Actions runs
