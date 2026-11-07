# Total.js Totem as a container. The image is the application and nothing else:
#   docker run --rm -p 8000:8000 -v "$PWD/token.txt:/run/secrets/totem_token:ro" -v "$PWD:/workspace" -v totem-data:/data totem
# The server listens on 0.0.0.0 inside the container, so an access token is mandatory: without one it refuses to start.

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4

# python3 is the pseudo-terminal of the interactive shell, git is the Git panel of the interface
RUN apk add --no-cache python3 git

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R node:node /app

COPY --chown=node:node . .

# The same config as everywhere else, except that it listens on all interfaces and reads the token from a Docker secret
RUN sed -i -E -e 's|^\$ip +:.*|$ip : 0.0.0.0|' -e 's|^tokenfile +:.*|tokenfile : /run/secrets/totem_token|' config \
	&& grep -q '^\$ip : 0.0.0.0' config && grep -q '^tokenfile : /run/secrets/totem_token' config

# The data folder is a volume, the projects are bind-mounted into /workspace
RUN mkdir -p /data /workspace && ln -s /data /app/databases && chown -R node:node /app /data /workspace

USER node
VOLUME /data
EXPOSE 8000

CMD ["node", "index.js", "8000", "--release"]
