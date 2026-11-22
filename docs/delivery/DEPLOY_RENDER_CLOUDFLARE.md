# Render and Cloudflare: step-by-step setup

What you do once (about 20 minutes). Never paste a key or token into the chat. Keys go in
**Project settings → Cloud environment → gear icon**, and a new Claude thread picks them up.

## Render: runs the Brew Haven API

1. Go to **render.com** → **Get started** → sign up with **GitHub** (the account that owns the
   `brew-haven` repo).
2. When Render asks for GitHub access, choose **Only select repositories** → `brew-haven` →
   **Install**. (Later: github.com → Settings → Applications → Render → Configure.)
3. Create an API key: top-right avatar → **Account settings** → **API Keys** → **Create API key**,
   name it `claude-deploy`, copy it.
4. In **Project settings**, add a **Network secret**:
   - Allowed website (host): `api.render.com`
   - Path prefix: `/v1/`
   - Header name: `Authorization`
   - Header value: `Bearer <the Render API key>`
5. (Optional, for the pilot) Add a payment card in Render → Billing. The demo runs on the **free**
   plan, which sleeps after 15 minutes without visitors (the first visit then takes about a minute,
   and background jobs pause). For the real pilot we move to **Starter (US$7 a month)**, which
   never sleeps.

What I do: create the service from `render.yaml` (Singapore), set its settings (database, secrets,
URLs), deploy, and check `/health/ready`.

## Cloudflare: hosts the customer app and the staff app, and your domain

1. Go to **dash.cloudflare.com** → sign up (free plan).
2. **Add your domain**: home → **Add a domain** → type your domain (for example `brewhaven.in`)
   → **Free** plan → continue. Cloudflare shows **two nameservers**.
3. At the company where you bought the domain (GoDaddy, Namecheap, Hostinger…), open the domain's
   **Nameservers** setting → **Custom** → paste Cloudflare's two nameservers → save. It switches
   in a few minutes to a few hours; Cloudflare emails you when the domain is **Active**.
4. Copy your **Account ID**: Cloudflare home → your account → the right-hand column (or
   **Account home → ⋯ → Copy account ID**). It isn't secret: send it to me in chat.
5. Create an API token: top-right avatar → **My Profile** → **API Tokens** → **Create Token** →
   **Create Custom Token** → **Get started**:
   - Name: `claude-deploy`
   - Permissions:
     - **Account** → **Cloudflare Pages** → **Edit**
     - **Zone** → **DNS** → **Edit**
   - Zone resources: **Include** → **Specific zone** → your domain
   - **Continue to summary** → **Create Token** → copy it (it is shown once).
6. In **Project settings**, add a **Network secret**:
   - Allowed website (host): `api.cloudflare.com`
   - Path prefix: `/client/v4/`
   - Header name: `Authorization`
   - Header value: `Bearer <the Cloudflare token>`

## Send me in chat

- The Cloudflare **Account ID**
- The **domain name**, and when Cloudflare says it is **Active**

## What you get

| Address | What it is |
|---|---|
| `order.<your-domain>` | Customer app (scan the QR, order, pay, track) |
| `staff.<your-domain>` | Staff app (counter, kitchen, owner setup) and `/platform` for your team |
| `api.<your-domain>` | The API on Render |

Until the domain is active, the apps also work on free `*.pages.dev` and `*.onrender.com` links.
