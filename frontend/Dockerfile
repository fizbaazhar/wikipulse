# --- build the static dashboard ---
FROM node:22-alpine AS build
WORKDIR /app
# Cypress is a dev tool for the e2e tests; don't download its browser into the image.
ENV CYPRESS_INSTALL_BINARY=0
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- serve it with nginx, proxying /api and /ws to the back end ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
