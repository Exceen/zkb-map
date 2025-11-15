FROM node:24
# FROM node:24-alpine

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8
ENV TZ Europe/Vienna

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install -g npm@9.6.4
RUN npm install --legacy-peer-deps
RUN npm install -g serve
# RUN npm install -g yarn

COPY . .

RUN yarn build
RUN yarn global add serve

EXPOSE 3131
CMD ["serve", "-s", "build", "-l", "3131"]