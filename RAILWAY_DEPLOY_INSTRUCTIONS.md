# Railway Deployment Fix Instructions

## Current Issues Identified

1. **Lockfile mismatch**: `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`
2. **Multiple deployments**: Railway deploying all workspace packages instead of just API server
3. **Build command**: Using frozen lockfile when configuration has changed

## Solutions Provided

### Option 1: Use Updated railway.toml (Recommended)
- Updated to use `--no-frozen-lockfile` 
- Targets only api-server for build and start
- Added proper environment variables

### Option 2: Use railway-simple.toml
- Simplified configuration using npm instead of pnpm
- Avoids workspace complexity

### Option 3: Use railway-deploy/ directory
- Isolated deployment directory with just the API server
- Minimal dependencies, no workspace complexity
- Cleanest approach for Railway

## Immediate Actions Required

### Step 1: Choose Your Deployment Method
**Option A (Recommended)**: Use the updated `railway.toml`
```bash
# The file is already updated, just commit and push
git add railway.toml .railwayignore
git commit -m "Fix Railway deployment - use no-frozen-lockfile and target api-server only"
git push
```

**Option B**: Use the isolated railway-deploy directory
```bash
# Copy API server files to railway-deploy
cp -r artifacts/api-server/src railway-deploy/
cp -r artifacts/api-server/build.mjs railway-deploy/
cp -r lib/db railway-deploy/
cp -r lib/api-zod railway-deploy/
# Then deploy from railway-deploy directory
```

### Step 2: Update Railway Settings
In Railway dashboard:
1. Go to your project settings
2. Set these environment variables:
   - `NODE_ENV=production`
   - `NIXPACKS_NODE_VERSION=20`
   - `DATABASE_URL` (your PostgreSQL URL)
   - `OPENAI_API_KEY` (your OpenAI key)
   - All other required variables from RAILWAY_ENV_SETUP.md

### Step 3: Deploy and Monitor
1. Push your chosen solution to GitHub
2. Railway will automatically redeploy
3. Monitor build logs for success
4. Check deployment logs for WhatsApp QR code

## Expected Results

After applying these fixes:
- ✅ Build will succeed without lockfile errors
- ✅ Only API server will be deployed (no admin/exam UI packages)
- ✅ WhatsApp bot will start and display QR code
- ✅ Railway will show healthy deployment status

## Troubleshooting

### If build still fails with lockfile error:
- Use Option 3 (railway-deploy directory) - completely avoids workspace issues
- Or manually regenerate lockfile: `pnpm install --no-frozen-lockfile`

### If Railway still tries to deploy multiple packages:
- Ensure `.railwayignore` is properly configured
- Use Option 3 for complete isolation

### If WhatsApp bot doesn't start:
- Check all environment variables are set
- Verify `DATABASE_URL` is correct
- Monitor deployment logs for specific errors

## Next Steps

1. Choose your preferred deployment option
2. Apply the changes
3. Push to GitHub
4. Monitor Railway deployment
5. Scan QR code when it appears in logs
