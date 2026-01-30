curl \
    -X POST \
    -u brainaccess:access1 \
    -H "Content-Type: application/json" \
    -d '{
        "index": {
            "fields": ["timestamp"]
        },
        "name": "timestamp-index",
        "type": "json"
        }' \
http://localhost:5984/neuroglancer/_index