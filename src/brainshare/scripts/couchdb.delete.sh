#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \

#curl \
#  -u eddyod:ax11992288 \
#  -X POST \
#  -H "Content-Type: application/json" \
#  -d '{"1091":["36-29f3f8e68b055d15a9a3b9f0609187b0"]}' \
#http://localhost:5984/neuroglancer/_purge

curl -X -u eddyod:ax11992288 DELETE http://localhost:5984/neuroglancer
curl -X -u eddyod:ax11992288 PUT http://localhost:5984/neuroglancer
