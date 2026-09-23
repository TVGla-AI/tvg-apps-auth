# Self-contained — build from this folder:
#   docker build -t tvg-whoami whoami
# In Coolify: Base Directory "/whoami", Dockerfile Location "/Dockerfile".
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY package.json server.js tvg-auth.js ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
