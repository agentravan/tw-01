FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# No lockfile is committed, so install from package.json.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["npm","start"]
