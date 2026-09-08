#https://www.brainsharer.org/brainsharer/annotations/
#  -u brainaccess:access1 \
#  -u eddyod:ax11992288 \

#    _id: string;
#	 _rev?: string;
#	 type: "base";
#	 version: number;
#	 data: any;
						  

junk=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)
curl \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"state":984, "owner":2, "note":"put stuff here"}' \
http://localhost:8000/notes
