#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \
#http://localhost:5984/neuroglancer/250
#http://eddyod:ax11992288@localhost:5984/neuroglancer/250

curl -X GET \
http://localhost:5984/users/_design/states/_view/by_id?include_docs=true&key=250
