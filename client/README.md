# IQ Agent Admin (Angular)

Admin UI for organizations, bots and EO sessions, served by the API at `/iqagent/admin/`.
See the "Admin UI" section of the repository README for pages, build and development.

```bash
npm ci                 # or, from the repo root: npm run client:install
npm start              # ng serve on :4200 with proxy (/iqagent/api -> localhost:3000)
npm run build          # -> ../public/admin/browser, base href /iqagent/admin/
```

Requires Node 22.12+.
