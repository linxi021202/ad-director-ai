# Temporary workspace retention

The browser initializes `/api/workspace/visit` before mounting the workbench.
A per-tab `sessionStorage` visit ID survives refresh and in-app navigation.
An active same-origin tab shares its visit ID via `BroadcastChannel`; Web Locks
serialize simultaneous initialization where supported. A new browser visit
without a surviving visit ID or active sibling starts a fresh workspace.
Browser session restoration can restore `sessionStorage` too, so a restored
tab is treated as the same visit, not reliably distinguishable from refresh.

The server only clears the authenticated anonymous session namespace. The
visit marker makes repeated requests idempotent. Unfinished generation
tasks block cleanup, preventing deletion during model result persistence.
Project directories, workspace selection and model-call history are cleared.
Built-in template source, public demo assets, model settings and other users'
session namespaces are not touched.

Videos with MIME type `video/*` and source `user-upload` or
`happyhorse-manual-import` are moved into the same session's private
`uploaded-videos` archive before projects are deleted. Their manifest records
remain accessible through the existing private video library endpoint.
Generated videos, uploaded product images, keyframes, audio, prompts and
storyboards are temporary and are removed on the next new visit.
Archived videos are private to the existing anonymous identity; clearing
browser cookies or expiration of that identity does not grant access to them
from a new session. Uploads still consume persistent storage capacity.

This lifecycle intentionally deletes historical work without an application
trash or restore flow. No database tables, credentials, infrastructure volume,
repository or system directories are deleted by the visit endpoint.
