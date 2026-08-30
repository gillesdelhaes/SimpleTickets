# Pinned to a digest, not just the mutable "16-alpine" tag — this is the
# one base image where a silent swap on rebuild matters most (it holds all
# the data). Re-pin deliberately: `docker pull postgres:16-alpine` then
# `docker inspect postgres:16-alpine --format '{{index .RepoDigests 0}}'`.
FROM postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

RUN apk add --no-cache openssl

COPY entrypoint.sh /usr/local/bin/custom-entrypoint.sh
RUN chmod +x /usr/local/bin/custom-entrypoint.sh

ENTRYPOINT ["custom-entrypoint.sh"]
CMD ["postgres"]
