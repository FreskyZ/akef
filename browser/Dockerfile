
# docker build --target msedge --tag my/msedge:1 .
FROM debian:13.4-slim AS msedge

# browser
# # without gpg the apt-get/dpkg command failed with something about post-installation script
# # the post install script can be found in /var/lib/dpkg/info/microsoft-edge-stable.postinst
# # add a set -x flag add the beginning of the file and see what command fails, this time it stops at a gpg command
RUN <<EORUN
set -ex
apt-get update
apt-get install -y --no-install-recommends ca-certificates
update-ca-certificates
sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources
apt-get update
# gpg: edge post install script is assuming gpg exist
apt-get install -y --no-install-recommends wget gpg
# browse available versions by remove filename part
wget https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable/microsoft-edge-stable_147.0.3912.60-1_amd64.deb -O microsoft-edge-stable.deb
apt-get install -y /microsoft-edge-stable.deb
rm microsoft-edge-stable.deb
EORUN

# webdriver, TODO merge the 2 layers together when next time update version
RUN <<EORUN
set -ex
apt-get install -y --no-install-recommends unzip
wget https://msedgedriver.microsoft.com/147.0.3912.60/edgedriver_linux64.zip -O edgedriver.zip
unzip edgedriver.zip
rm edgedriver.zip
rm -rf Driver_Notes
EORUN

RUN <<EORUN
set -ex
apt-get install -y --no-install-recommends socat
EORUN

# # the correct way to fight against stupid fixed listen localhost is exec socat
# docker run -d --rm --name edge1 -p8002:8002 -p8004:8004 my/msedge:1
# docker exec -d edge1 socat TCP-LISTEN:8002,fork,reuseaddr TCP:127.0.0.1:8001
# docker exec -d edge1 socat TCP-LISTEN:8004,fork,reuseaddr TCP:127.0.0.1:8003
# docker run -it --rm --name webdriver1 --network host -v.:/work -w /work -h WEBDRIVER <node image and shell entrypoint>
#
# 8003: webdriver port, webdriver protocol endpoint port
# 8004: map localhost 8003 to public 8004, connect webdriver from other container
# 8001: browser debugging port, also cdp protocol endpoint
# 8002: map localhost 8001 to public 8002, open devtools url on windows
#
# check ps: docker top edge1
# check cdp api: localhost:8002/json/version, localhost:8002/json/list
# check webdriver classic api: localhost:8004/status, localhost:8004/session/{sessionId}/window/handles
# delete session: curl -X DELETE localhost:8004/session/{sessionId}
# devtools frontend: http://localhost:8002/devtools/inspector.html?ws=localhost:8002/devtools/page/{pageid}

ENTRYPOINT ["/msedgedriver", "--port=8003", "--allow-origins=*", "--disable-dev-shm-usage"]
