# Deploying to GitHub + Hostinger

> ⚠️ **Plan check:** This is a Node.js/Express app. It will **not** run on
> Hostinger's standard *Web Hosting* (Premium/Business) plans — those only run
> PHP. You need a **VPS** plan (recommended) or a Cloud plan that exposes
> Node.js. The guide below uses a Hostinger **VPS**.

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

## Common pitfalls
- **App exits immediately** → missing Firebase credentials. Check `.env` /
  `serviceAccountKey.json` and `pm2 logs`.
- **Can't reach the site** → open the firewall: `ufw allow 80; ufw allow 443`.
- **Login doesn't persist** → keep PM2 at **1 instance** (fork mode); the
  session store is in-memory. For multi-instance, add a shared session store.
