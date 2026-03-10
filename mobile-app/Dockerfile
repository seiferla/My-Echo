FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 8081
EXPOSE 19000
EXPOSE 19001
EXPOSE 19002

CMD ["npx", "expo", "start", "--web", "--port", "8081"]
