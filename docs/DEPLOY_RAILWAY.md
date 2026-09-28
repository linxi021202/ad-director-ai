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
DEEPSEEK_MODEL=deepseek-v4-pro
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com
DASHSCOPE_SUBMISSION_TIMEOUT_MS=30000
QWEN_IMAGE_MODEL=qwen-image-max-2025-12-30
QWEN_IMAGE_EDIT_MODEL=qwen-image-edit-max-2026-01-16
HAPPYHORSE_BASE_URL=https://dashscope.aliyuncs.com
HAPPYHORSE_MODEL=happyhorse-1.0-r2v
COSYVOICE_BASE_URL=https://dashscope.aliyuncs.com
COSYVOICE_MODEL=cosyvoice-v3-flash
```

Do not configure platform-wide model API keys. Each visitor supplies their own keys through the server-only session settings flow.
The three image workflows use the task-aware Qwen router's dated model pools; these two model variables are defaults for direct client calls, not overrides for that router.
The submission timeout is independent of the image generation timeout. Keep the default until production network diagnostics explain a submission delay; raising it alone does not resolve connectivity or oversized requests.

## First deployment

1. Add the variables before deploying.
2. Attach the persistent volume before the first real project is created.
3. Deploy and wait for `/api/health` to return `status: ok`.
4. Generate a Railway public domain.
5. Test the full workflow in two separate browser sessions.

Deployments interrupt an active in-process render. After a restart, the project reports the interrupted render as failed and allows the visitor to retry.

## Storage capacity

Image generation requires at least 32 MiB free on `STORAGE_ROOT`; three-candidate batches require 64 MiB. The reserve protects project metadata and logs. Requests are rejected before paid model submission when capacity is insufficient.
`/api/health` reports `status: degraded`, free/total bytes and `imageGenerationReady: false` when storage is low, while returning HTTP 200 so the service remains accessible for recovery. Deployment readiness failures still return HTTP 503.
An `ENOSPC` or `EDQUOT` write failure is a storage problem, not a Qwen model or account failure. Expand the attached Railway volume or explicitly remove unneeded assets after checking their references; never delete the volume or active project files to free space. A plan upgrade and the attached volume size must both be checked in Railway; do not assume upgrading alone resized the existing volume.
