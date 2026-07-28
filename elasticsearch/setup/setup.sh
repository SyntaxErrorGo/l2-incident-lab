#!/bin/sh
set -eu

curl --fail --silent --show-error \
  -X PUT http://elasticsearch:9200/_index_template/l2-incident-lab \
  -H 'Content-Type: application/json' \
  -d '{
    "index_patterns": ["l2-incident-lab-*"],
    "priority": 500,
    "template": {
      "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 0
      },
      "mappings": {
        "properties": {
          "timestamp": {"type": "date"},
          "level": {"type": "keyword"},
          "service": {"type": "keyword"},
          "message": {"type": "text"},
          "request_id": {"type": "keyword"},
          "method": {"type": "keyword"},
          "path": {"type": "keyword"},
          "status_code": {"type": "integer"},
          "duration_ms": {"type": "float"}
        }
      }
    }
  }'
