#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \


curl \
  -u eddyod:ax11992288 \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{"_rev":"11-babb1b1c30e59c78510b3dcfcd239350", "active" : 0, "animal" : "X", "comments" : "hey joe"}' \
http://127.0.0.1:5984/users/250

