FROM nginx:1.27-alpine

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY api.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

COPY nginx.conf /etc/nginx/nginx.conf
RUN rm -f /etc/nginx/conf.d/default.conf

VOLUME /app/data

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
