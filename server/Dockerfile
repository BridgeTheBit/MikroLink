FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache su-exec && mkdir -p /data && chown node:node /data
COPY package.json ./
COPY src ./src
COPY certs ./certs
ENV API_HOST=0.0.0.0 API_PORT=8080 API_BEHIND_PROXY=1 DATA_FILE=/data/state.json
EXPOSE 8080
VOLUME /data
CMD ["sh", "-c", "chown node:node /data && exec su-exec node node src/main.js"]
