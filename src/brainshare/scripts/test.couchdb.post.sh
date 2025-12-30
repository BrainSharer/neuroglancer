#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \
#  -u eddyod:ax11992288 \

{
  "type": "patch",
    "baseVersion": {
	     "$gte": 1
		    }
			 }


curl \
  -X POST \
  -u brainaccess:access1 \
  -H "Content-Type: application/json" \
  -d '{"selector": {"type":"patch", "baseVersion": { "\$gte": 1} } }' \
http://localhost:5984/neuroglancer/_find
