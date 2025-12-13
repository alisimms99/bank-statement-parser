# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS builder

ENV NODE_ENV=production
ENV PNPM_HOME="/usr/local/bin"
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /app

# build scripts use bash; CA certs required for package downloads
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Use the repo-pinned pnpm version (packageManager field)
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Install deps with good Docker cache behavior; patches must exist during install
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod=false

# Copy source and build the Cloud-Run-ready artifact into ./prod
COPY . .
RUN pnpm build:prod


FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /prod

# Required by pdfjs-dist for server-side PDF parsing
RUN apt-get update \
  && apt-get install -y --no-install-recommends libcups2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the production artifact from the builder stage
COPY --from=builder /app/prod/ ./

EXPOSE 8080

CMD ["node", "./dist/index.js"]

