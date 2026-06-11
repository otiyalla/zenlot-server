## Context

This note summarizes a debugging conversation about a NestJS (Fastify) API failing to start in production with:

- **Error**: `listen EACCES: permission denied 0.0.0.0:443`
- **Domain**: `api.zenlot.net`
- **Runtime**: Node.js/NestJS on **AWS EC2 (Amazon Linux)**

## Why this happens

### Binding to port 443 is privileged

On Linux, ports **< 1024** (including **443**) are privileged. If your Node process runs as a normal user, it will fail to bind to `:443` with **EACCES**.

In `src/main.ts`, the app listens on whatever `PORT` resolves to:

- `const port = process.env.PORT || 3000;`
- `await app.listen(port, '0.0.0.0');`

So if your production environment sets `**PORT=443`**, Node tries to bind `0.0.0.0:443` and crashes unless it has elevated privileges/capabilities.

### Removing `0.0.0.0` does not fix EACCES on 443

Whether you bind to `0.0.0.0`, `127.0.0.1`, or omit the host entirely, **binding to port 443 still requires privileged access**. The host affects *which interfaces* you bind to, not the privilege requirement of the port.

## Recommended fix (standard production setup)

Run NestJS on an **unprivileged port** (e.g. `3000` or `8080`) and put a reverse proxy in front (Nginx/Caddy/ALB) that terminates TLS on **443** and proxies to your app.

### Target architecture

- **Client** → `https://api.zenlot.net` (443)
- **Nginx** listens on **80/443**
- **Nginx** proxies to `**http://127.0.0.1:3000`**
- **NestJS** listens on `**0.0.0.0:3000`** (or `127.0.0.1:3000`; both are fine when only Nginx needs access)

## Step-by-step (Amazon Linux on EC2)

### 1) Ensure NestJS is not trying to listen on 443

- **Do not set `PORT=443`** for the NestJS process.
- Prefer `**PORT=3000**` (or similar) and run your process manager/service with that environment.

Quick local check on the instance:

```bash
curl -sS http://127.0.0.1:3000/ || true
```

### 2) Security group rules

In the EC2 instance security group inbound rules:

- Allow **HTTP 80** from `0.0.0.0/0`
- Allow **HTTPS 443** from `0.0.0.0/0`
- Do **not** expose **3000** publicly (keep it internal-only)

### 3) Install and enable Nginx

```bash
sudo yum install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
sudo systemctl status nginx
```

### 4) Create Nginx reverse proxy config (Amazon Linux)

On Amazon Linux, you typically **do not** use `/etc/nginx/sites-available` or `/etc/nginx/sites-enabled`.

Instead, create a file in:

- `**/etc/nginx/conf.d/`** (recommended)

Create:

```bash
sudo nano /etc/nginx/conf.d/zenlot.conf
```

Example config (HTTP only; HTTPS is added in the next step):

```nginx
server {
    listen 80;
    server_name api.zenlot.net;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 5) DNS

Ensure `api.zenlot.net` resolves to your EC2 instance (or to an ELB in front of it).

### 6) Add HTTPS with Certbot (Let’s Encrypt)

Install Certbot (package names can vary slightly by Amazon Linux version):

```bash
sudo yum install -y certbot python3-certbot-nginx
```

Then:

```bash
sudo certbot --nginx -d api.zenlot.net
```

Choose the option to redirect HTTP → HTTPS if prompted.

### 7) Verify end-to-end

```bash
curl -I http://api.zenlot.net/
curl -I https://api.zenlot.net/
```

## Alternatives (not recommended unless you know why)

- Run Node as root to bind `:443` (security risk).
- Grant `CAP_NET_BIND_SERVICE` to the Node binary (Linux-specific; still increases risk).
- Use an AWS load balancer (ALB/NLB) to terminate TLS and forward to your instance on `:3000` (also a solid approach, just different from Nginx-on-instance).

