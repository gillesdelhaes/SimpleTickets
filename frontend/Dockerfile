# Stage 1 — build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/locations.conf /etc/nginx/locations.conf
# Both variants are staged here, not directly in conf.d — the entrypoint
# picks one at container start based on whether a TLS cert is mounted.
COPY nginx/http.conf nginx/tls.conf /etc/nginx/available/
COPY nginx-entrypoint.sh /nginx-entrypoint.sh
RUN chmod +x /nginx-entrypoint.sh
EXPOSE 80 443
ENTRYPOINT ["/nginx-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
