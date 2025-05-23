#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \
#  -u eddyod:ax11992288 \

curl \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"_id" : "250", "editor": "edward", "otherUsers": []}' \
http://localhost:5984/users/_changes?feed=continuous&include_docs=true&filter=_doc_ids&since=now
http://localhost:5984/users/_changes?include_docs=true&filter=filters/by_key&key=
