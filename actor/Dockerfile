FROM apify/actor-node:22

COPY package.json ./
RUN npm install --omit=optional

COPY . ./

CMD ["npm", "start"]
