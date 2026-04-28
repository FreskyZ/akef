# what do you mean by compiling and running the rust script need to install several packages and one package is missing and you need to build it from source?
# now that you have a dockerfile to setup build environment, you can build a final result binary and directly use outside?

FROM alpine:3.23.4 AS base

RUN <<EORUN
set -ex
cat <<'EOCAT' > /etc/apk/repositories
https://mirrors.aliyun.com/alpine/v3.23/main
https://mirrors.aliyun.com/alpine/v3.23/community
EOCAT
apk update
# musl-dev I gess comes from image
# pkgconfig and openssl-dev required by some http library for reqwest
# openssl-libs-static, required by tokio::main
# meson ninja gcc nasm: build dav1d from source
apk add musl-dev pkgconfig openssl-dev openssl-libs-static meson ninja gcc nasm --no-cache
EORUN

# https://code.videolan.org/videolan/dav1d
ADD dav1d.tar.xz /dav1d

RUN <<EORUN
set -ex
cd /dav1d
mkdir build
cd build
meson setup --default-library=static ..
ninja
EORUN

FROM my/rust:1 AS main

RUN <<EORUN
set -ex
apk update
# musl-dev I gess comes from image
# pkgconfig and openssl-dev required by some http library for reqwest
# openssl-libs-static, required by tokio::main
apk add musl-dev pkgconfig openssl-dev openssl-libs-static --no-cache
EORUN

COPY --from=base /dav1d/build/src/libdav1d.a /usr/local/lib
