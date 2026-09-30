
// workflow
// 1. start browser 
//    docker run -d --rm --name edge1 -p8002:8002 -p8004:8004 my/msedge:1
//    docker exec -d edge1 socat TCP-LISTEN:8002,fork,reuseaddr TCP:127.0.0.1:8001
//    docker exec -d edge1 socat TCP-LISTEN:8004,fork,reuseaddr TCP:127.0.0.1:8003
// 2. get data
//    docker run -it --rm --name akef1 --network host -v.:/work -w /work -h AKEF1 my/node:1
//    node recipe/get-item.ts && node recipe/get-recipe.ts
