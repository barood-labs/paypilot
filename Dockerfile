# Hugging Face Docker Space / any container host. Mock mode unless PayPal sandbox keys are set as secrets.
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
