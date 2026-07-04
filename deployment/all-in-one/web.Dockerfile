FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm --workspace @mo-devflow/web run build

FROM nginx:1.29-alpine

COPY deployment/all-in-one/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
