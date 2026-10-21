
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

RUN pip3 install --break-system-packages --no-cache-dir yt-dlp

COPY . .

ENV NODE_ENV=production

CMD ["node", "server.js"]
