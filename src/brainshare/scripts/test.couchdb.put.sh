#!/bin/bash

set -eu

# Configuration
COUCHDB_URL="http://raspberry.eddyod.com"
DB_NAME="neuroglancer"
DOC_ID="1115"
USERNAME="brainaccess"
PASSWORD="access1"
AUTH="-u $USERNAME:$PASSWORD"
DATE=$(date)

# 1. Fetch the current document and extract the latest revision (_rev)
# Use curl with -s (silent) and pipe the output to jq to extract the _rev field
DOC_INFO=$(curl -s $AUTH "$COUCHDB_URL/$DB_NAME/$DOC_ID")

CURRENT_REV=$(echo $DOC_INFO | jq -r '._rev')

if [ "$CURRENT_REV" == "null" ]; then
  echo "Error: Document $DOC_ID not found or could not fetch revision."
  exit 1
fi

echo "Fetched $CURRENT_REV from $COUCHDB_URL/$DB_NAME/$DOC_ID"

# 2. Define the new document data, including the fetched _rev
# You can modify the data part as needed
NEW_DATA=$(cat <<EOF
{"_id":"$DOC_ID", "_rev":"$CURRENT_REV", "data": {"timestamp":"$DATE"}  }
EOF
)



# 3. Use a PUT statement with curl to update the document
echo "Sending PUT request with new data..."
# Use curl with -X PUT, set Content-Type header, and provide data in the body
#response=$(curl -s -X PUT $AUTH -H "Content-Type: application/json" "$COUCHDB_URL/$DB_NAME/$DOC_ID" -d "$NEW_DATA")
response=$(curl -s -X PUT $AUTH -H "Content-Type: application/json" "$COUCHDB_URL/$DB_NAME/$DOC_ID" -d @basedoc.1115.json )

echo "Server response: $response"

# Optional: Check if the update was successful
if echo "$response" | jq -e '.ok' >/dev/null; then
  echo "Document updated successfully."
else
  echo "Failed to update document."
fi

