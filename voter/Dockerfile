FROM node:18-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm i

# Copy the rest of the application
COPY . .

# Build TypeScript
RUN npm run build

# Expose the port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]