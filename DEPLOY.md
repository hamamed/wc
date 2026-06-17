# Deploying to GitHub + Hostinger

> ⚠️ **Plan check:** This is a Node.js/Express app. It will **not** run on
> Hostinger's standard *Web Hosting* (Premium/Business) plans — those only run
> PHP. You need a **VPS** plan (recommended) or a Cloud plan that exposes
> Node.js. The guide below uses a Hostinger **VPS**.
>
> 👉 **No VPS?** See [NO-VPS hosting](#no-vps-host-free--keep-your-hostinger-domain)
> below — host the app free on Render and point your Hostinger domain at it.

---

## Part A — Push the project to GitHub

From the `worldcup-predictor` folder:

```bash
git init
git add .
git commit -m "World Cup 2026 Predictor"
git branch -M main
git remote add origin https://github.com/<your-username>/worldcup-predictor.git
git push -u origin main
```

✅ `.gitignore` already excludes `node_modules/`, `.env`, and
`serviceAccountKey.json`, so your Firebase secret is **never** pushed to GitHub.

---

## Part B — Deploy on a Hostinger VPS

### 1. Create the VPS
In hPanel → **VPS** → choose a plan → pick an OS template. Easiest is
**Ubuntu 22.04 with the "Node.js" template**, or plain Ubuntu 22.04.
Note the server's **IP address** and **root password**.

### 2. SSH into the server
```bash
ssh root@<your-server-ip>
```

### 3. Install Node.js + tools (skip if your template already has Node)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
npm install -g pm2
```

### 4. Clone your repo
```bash
cd /var/www
git clone https://github.com/<your-username>/worldcup-predictor.git
cd worldcup-predictor
npm install --production
```

### 5. Add your secrets on the server
Create the `.env` file:
```bash
nano .env
```
Paste (fill in real values):
```
PORT=3000
SESSION_SECRET=<long-random-string>
ADMIN_PASSWORD=<your-admin-password>
# Easiest credential method on a server — the whole JSON on one line:
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ...}
```
Save (Ctrl+O, Enter, Ctrl+X).

> Alternatively, upload `serviceAccountKey.json` to the project folder via SFTP
> instead of setting `FIREBASE_SERVICE_ACCOUNT`.

### 6. Start it with PM2 (auto-restart + survive reboots)
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # run the command it prints, to enable boot startup
```
Your app is now running on `http://<your-server-ip>:3000`.

### 7. Put Nginx in front (serve on port 80 + your domain)
```bash
apt-get install -y nginx
nano /etc/nginx/sites-available/wc2026
```
Paste:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable it:
```bash
ln -s /etc/nginx/sites-available/wc2026 /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```

### 8. Point your domain + add HTTPS
- In Hostinger DNS, set an **A record** for your domain → your VPS IP.
- Free SSL with Let's Encrypt:
  ```bash
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d yourdomain.com -d www.yourdomain.com
  ```

If the app runs behind HTTPS, also tell Express to trust the proxy — add this
near the top of `server.js` (after `const app = express();`):
```js
app.set("trust proxy", 1);
```

---

## Updating the app later
```bash
cd /var/www/worldcup-predictor
git pull
npm install --production
pm2 restart wc2026-predictor
```

---

## Alternative: Hostinger Cloud / hPanel "Node.js" setup
If your plan has a **Node.js** entry in hPanel instead of VPS SSH:
1. Upload the repo (or connect GitHub) to your hosting directory.
2. In the Node.js app manager set **Application root** to the project folder,
   **Startup file** to `server.js`, and Node version 18+.
3. Add the environment variables (`SESSION_SECRET`, `ADMIN_PASSWORD`,
   `FIREBASE_SERVICE_ACCOUNT`) in that panel.
4. Run **npm install**, then **Start**. The panel handles the port + proxy.

---

## NO-VPS: host free + keep your Hostinger domain

If you don't have a VPS, you cannot run Node on standard Hostinger web hosting.
Instead, deploy the app to a free Node host that builds straight from GitHub,
then point your Hostinger **domain** at it. Your site still lives on your
domain — only the server runs elsewhere. **Render** is the simplest; the steps:

### 1. Push to GitHub
(See Part A above.)

### 2. Create the app on Render
1. Sign up at <https://render.com> (free) and click **New → Web Service**.
2. Connect GitHub and pick your `worldcup-predictor` repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Add **Environment Variables** (this replaces your local `.env`):
   - `SESSION_SECRET` = a long random string
   - `ADMIN_PASSWORD` = your admin password
   - `FIREBASE_SERVICE_ACCOUNT` = the **entire** service-account JSON on one line
   - (don't set `PORT` — Render provides it; the app already reads `process.env.PORT`)
5. Click **Create Web Service**. Render builds and gives you a live URL like
   `https://worldcup-predictor.onrender.com`. Test it works.

### 3. Connect your Hostinger domain
1. In Render: open your service → **Settings → Custom Domains → Add**.
   - Enter `www.yourdomain.com` (and/or `yourdomain.com`).
   - Render shows the DNS record(s) to create.
2. In **Hostinger hPanel → Domains → DNS / Nameservers → DNS records**, add what
   Render asked for, typically:
   - `www` → **CNAME** → `worldcup-predictor.onrender.com`
   - root `@` → the **A record IP** Render lists (or use Hostinger's redirect
     from `@` to `www`).
3. Wait for DNS to propagate (minutes to a couple hours). Render auto-issues a
   free HTTPS certificate once it verifies the domain.

Done — `https://yourdomain.com` now serves the app.

### Free-tier notes
- Render's free service **sleeps after ~15 min idle**; the first visit then
  takes ~30s to wake. Fine for a hobby app. Paid tier removes this.
- Keep it a **single instance** (the in-memory session store needs that). A
  restart just means users re-enter their username — no password, so trivial.
- **Alternatives** that also deploy from GitHub: **Railway**, **Koyeb**,
  **Cyclic**, **Fly.io**. Same idea — set the env vars, then point DNS.

---

## Common pitfalls
- **App exits immediately** → missing Firebase credentials. Check `.env` /
  `serviceAccountKey.json` and `pm2 logs`.
- **Can't reach the site** → open the firewall: `ufw allow 80; ufw allow 443`.
- **Login doesn't persist** → keep PM2 at **1 instance** (fork mode); the
  session store is in-memory. For multi-instance, add a shared session store.
