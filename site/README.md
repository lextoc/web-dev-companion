# Web Dev Companion Website

This folder is a standalone static website for Web Dev Companion. It does not
depend on the Electron/Vue app build, so it can be deployed by copying the
contents of `site/` to any static web root.

## Local Preview

From this folder:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## DigitalOcean Droplet Deployment

One safe pattern on a droplet that already hosts other sites is to give this
site its own web root and Nginx server block. From the repository root:

```sh
sudo mkdir -p /var/www/web-dev-companion
sudo rsync -av --delete \
  --exclude README.md \
  --exclude nginx.web-dev-companion.example.conf \
  ./site/ /var/www/web-dev-companion/
sudo cp ./site/nginx.web-dev-companion.example.conf /etc/nginx/sites-available/web-dev-companion
sudo ln -s /etc/nginx/sites-available/web-dev-companion /etc/nginx/sites-enabled/web-dev-companion
sudo nginx -t
sudo systemctl reload nginx
```

The included Nginx file is configured for `web-dev-companion.com` and
`www.web-dev-companion.com`. Keep the `root` path aligned with the copy target if
you deploy the files somewhere else.

If the droplet already uses Certbot, add TLS after DNS points at the droplet:

```sh
sudo certbot --nginx -d web-dev-companion.com -d www.web-dev-companion.com
```
