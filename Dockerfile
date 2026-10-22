FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# التثبيت بعد نسخ الكود حتى لا تُستعاد طبقة قديمة من الكاش عند تغيّر الكود
# [default] يجلب yt-dlp-ejs المطلوب لـ YouTube
RUN pip3 install --break-system-packages --no-cache-dir --upgrade "yt-dlp[default]" \
    && python3 -m yt_dlp --version

ENV NODE_ENV=production

CMD ["node", "server.js"]
