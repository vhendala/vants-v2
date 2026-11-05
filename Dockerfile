# Vants backend image (T-027, DEC-045): the API and the worker from one image; compose picks the command.
# The mini app is NOT in it: it is served by Vercel (deploy/web.sh), which forwards the API routes here.
FROM node:24.18.1-slim
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY . .
# Only the two processes and the workspace packages they depend on.
RUN pnpm install --frozen-lockfile --prod --filter "@vants/api..." --filter "@vants/worker..." \
  && rm -rf /root/.local/share/pnpm /root/.cache
USER node
ENV HOST=0.0.0.0 API_PORT=3100
EXPOSE 3100
CMD ["node", "apps/api/src/main.ts"]
