#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \
#  -u eddyod:ax11992288 \

#    _id: string;
#	 _rev?: string;
#	 type: "base";
#	 version: number;
#	 data: any;
						  


curl \
  -X POST \
  -u brainaccess:access1 \
  -H "Content-Type: application/json" \
  -d '{"_id": "666", "type":"base", "version":"0", "data": "{}"  }' \
http://raspberry.eddyod.com/neuroglancer
