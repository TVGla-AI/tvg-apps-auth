# Self-contained — build from the repo root:
#   docker build -t tvg-apps-auth .
# In Coolify: Base Directory "/", Dockerfile Location "/Dockerfile".
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY package.json server.js tvg-auth.js ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
