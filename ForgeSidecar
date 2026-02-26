# 1. Start with a lightweight Linux image that already has Node.js installed
FROM node:20-bookworm-slim

# 2. Install Java 17 (The minimum requirement to run Forge)
# We clean up the apt cache afterwards to keep the image size extremely small
RUN apt-get update && \
    apt-get install -y openjdk-17-jre-headless && \
    rm -rf /var/lib/apt/lists/*

# 3. Set up the working directory inside our container
WORKDIR /app

# 4. Copy the Node.js package files and install dependencies (ws, ts-node, etc.)
COPY package*.json ./
RUN npm install

# 5. Copy your TypeScript server code into the container
COPY server.ts ./
COPY tsconfig.json ./
COPY parser.ts ./

# 6. Copy the Forge Java engine into the container
# (This assumes you have placed forge.jar in the same folder as this Dockerfile)
COPY forgeSim.jar ./
# Note: Forge usually requires a "res" (resources) folder next to the jar.
# If you have it, uncomment the line below to copy it in as well.
 COPY res/ ./res/

# 7. Expose port 8080 so your Next.js app can connect to the WebSocket
EXPOSE 8080

# 8. The automated startup command
CMD ["node", "--import", "ts-node/esm", "server.ts"]
