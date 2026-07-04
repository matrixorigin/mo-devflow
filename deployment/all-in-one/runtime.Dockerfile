FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY config ./config

RUN npm ci

ENV MO_DEVFLOW_API_HOST=0.0.0.0

USER node

CMD ["npm", "run", "start:api"]
