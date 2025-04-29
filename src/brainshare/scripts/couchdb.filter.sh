
# "map": "function(doc) { if (doc) emit(doc.id, null); }"
# "map": "function(doc) { if (doc) emit(doc.data.id, null); }"



#curl -X GET "http://localhost:5984/users/_changes?include_docs=true&filter=filters/by_key&key=250"
#curl -X GET "http://localhost:5984/neuroglancer/_changes?filter=filters/by_key&key=250&include_docs=true"
#curl -X GET "http://localhost:5984/neuroglancer/_design/by_key/_view/by_key?include_docs=true&key=250"
curl -X GET "http://localhost:5984/neuroglancer/_design/by_key/_view/by_key?include_docs=true&key=250"
