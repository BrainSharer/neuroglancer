#echo quit | openssl s_client -showcerts -servername server -connect server:443 > couch.pem
#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \
#http://localhost:5984/neuroglancer/250
#http://eddyod:ax11992288@localhost:5984/neuroglancer/250
#https://nosql.dk.ucsd.edu/users/_changes?filter=_doc_ids&include_docs=false&descending=false
#https://nosql.eddyod.com/neuroglancer/250

curl -X GET \
  -u brainaccess:access1 \
https://nosql.dk.ucsd.edu/users/250
