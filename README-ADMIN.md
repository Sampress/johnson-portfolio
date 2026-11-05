# Admin setup

Requires Node 16+ (no `npm install` needed).

1. Create your login (once):      node setup-admin.js
2. Start the site:                node server.js
3. Open  http://localhost:3000/        (site)
         http://localhost:3000/admin/  (admin)

## What the admin can do
- Works tab: add / edit / delete / reorder, upload images (big images are shrunk automatically),
  and fill in optional details (description, technologies, role, result, live + GitHub links)
  that appear on each project's own page (work.html).
- Messages tab: everything sent through the site's contact form. Check it regularly -
  there is no email notification. A red badge shows unread messages.

## Notes
- Content lives in data/ (works.json, messages.json, admin.json) and images/uploads/. Back them up.
- Only index.html, work.html, your CV PDF and the css/js/fonts/images/admin folders are public.
- Hosting needs a Node host (Render, Railway, a VPS...). Use HTTPS and set these environment variables:
    NODE_ENV=production
    SITE_URL=https://your-domain.com     (used for link previews on WhatsApp/LinkedIn)
- Forgot the password? Run  node setup-admin.js  again.
