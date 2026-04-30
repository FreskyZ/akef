
# docker build --target build --tag akef/recipe-build --build-context project=.. .
FROM my/rust:1 AS build

RUN mkdir /work && mkdir /work/src
COPY --from=project Cargo.toml Cargo.lock /work
COPY make-icon.rs /work/src/main.rs

# /usr/local/cargo/registry: cargo download cache, the CARGO_HOME=/usr/local/cargo is written by me in my/rust image
# if you are developing the script, mount host cache folder to that location, e.g.
# docker run -it --rm --name akef2 -v ~/cargo-download-cache:/usr/local/cargo/registry -h AKEF2 -w /work akef/recipe-build
RUN --mount=type=cache,target=/usr/local/cargo/registry <<EORUN
set -ex
apk update
# musl-dev I gess comes from image
# pkgconfig and openssl-dev required by some http library for reqwest
# openssl-libs-static, required by tokio::main
apk add musl-dev pkgconfig openssl-dev openssl-libs-static --no-cache
cd /work
cargo build --release
# result file /work/target/release/akef
EORUN

# docker create --name helper1 akef/recipe-build
# docker cp helper1:/work/target/release/akef make-icon
# docker rm helper1
# # this executable file statically links libc? you can run directly on host?
