# Railway deployment

AdDirector AI must run as one persistent Docker service until its in-memory BYOK store and render grants are replaced by shared services.

## Service settings

- Source: the private GitHub repository.
- Builder: the root `Dockerfile` is detected automatically.
- Replicas: exactly `1`.
- Healthcheck path: `/api/health`.
- Healthcheck timeout: `300` seconds.
- Restart policy: `On Failure`.
- Volume mount path: `/app/storage`.
- Recommended initial resources: 4 vCPU and 8 GB RAM.

## Required variables

```dotenv
NODE_ENV=production
AI_MODE=real
ENABLE_REAL_TEXT=true
ENABLE_REAL_IMAGE=true
ENABLE_REAL_VIDEO=true
ALLOW_PLATFORM_KEYS=false
STORAGE_ROOT=/app/storage
ANONYMOUS_SESSION_OWNERSHIP_SALT=<generate-a-random-64-character-value>
REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
MAX_CONCURRENT_RENDERS=1
MAX_RENDER_QUEUE_SIZE=6

DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com
QWEN_IMAGE_MODEL=qwen-image
QWEN_IMAGE_EDIT_MODEL=qwen-image-2.0
HAPPYHORSE_BASE_URL=https://dashscope.aliyuncs.com
HAPPYHORSE_MODEL=happyhorse-1.0-r2v
COSYVOICE_BASE_URL=https://dashscope.aliyuncs.com
COSYVOICE_MODEL=cosyvoice-v3-flash
```

Do not configure platform-wide model API keys. Each visitor supplies their own keys through the server-only session settings flow.

## First deployment

1. Add the variables before deploying.
2. Attach the persistent volume before the first real project is created.
3. Deploy and wait for `/api/health` to return `status: ok`.
4. Generate a Railway public domain.
5. Test the full workflow in two separate browser sessions.

Deployments interrupt an active in-process render. After a restart, the project reports the interrupted render as failed and allows the visitor to retry.
