# Railway.app Environment Variables Setup

## Required Environment Variables

Set these in your Railway project settings:

### Core Variables
- `NODE_ENV=production`
- `NIXPACKS_NODE_VERSION=20`
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key for GPT functionality

### WhatsApp Bot Variables
- `WHATSAPP_PHONE_NUMBER_ID` - WhatsApp Business API ID
- `WHATSAPP_ACCESS_TOKEN` - WhatsApp Business API token
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` - Webhook verification token

### External Services
- `BOOKITIT_PUBLIC_KEY` - Bookitit API public key
- `BOOKITIT_PRIVATE_KEY` - Bookitit API private key
- `BOOKITIT_AGENDA_ID` - Bookitit agenda ID
- `BOOKITIT_SERVICE_ID` - Bookitit service ID
- `BOOKITIT_SERVICE_EXAM_ID` - Bookitit exam service ID
- `IGIVETEST_USERNAME` - IGiveTest username
- `IGIVETEST_PASSWORD` - IGiveTest password

### Google Services
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - Google OAuth redirect URI

### Storage
- `GOOGLE_CLOUD_PROJECT_ID` - GCP project ID
- `GOOGLE_CLOUD_KEYFILE` - GCP service account key (base64)
- `GOOGLE_CLOUD_BUCKET_NAME` - GCS bucket name

## Railway Configuration

### Option 1: Using railway.toml (Recommended)
The `railway.toml` file is already configured to:
- Build only the API server (skips UI components)
- Start the WhatsApp bot directly
- Set proper Node.js version

### Option 2: Using Dockerfile
Use `Railway.Dockerfile` if you prefer Docker-based deployment:
- Includes all Chromium dependencies
- Optimized for WhatsApp Web.js
- Isolated environment

### Option 3: Manual Railway Settings
In Railway dashboard:
1. Go to Settings → Variables
2. Set `NIXPACKS_BUILD_CMD = cd artifacts/api-server && pnpm run build`
3. Set `NIXPACKS_START_CMD = cd artifacts/api-server && node dist/index.mjs`

## Deployment Steps

1. Push changes to GitHub
2. Connect repository to Railway
3. Set environment variables
4. Deploy and monitor logs for QR code
5. Scan QR code with WhatsApp

## Troubleshooting

### Build Failures
- Check TypeScript errors: `pnpm run typecheck`
- Verify all dependencies are installed
- Check Railway build logs

### Runtime Issues
- Verify `DATABASE_URL` is correct
- Check WhatsApp API credentials
- Ensure Chromium dependencies are installed

### QR Code Not Showing
- Check logs for WhatsApp Web.js initialization
- Verify `CHROME_BIN` and `CHROME_PATH` environment variables
- Ensure proper Chromium installation
