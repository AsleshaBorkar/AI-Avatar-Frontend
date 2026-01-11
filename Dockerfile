# ---------- Stage 1: Build ----------
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Accept build-time variable
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build


# ---------- Stage 2: Nginx ----------
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
