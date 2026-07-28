#!/bin/sh
set -eu

curl --fail --silent --show-error \
  -X POST http://kibana:5601/api/data_views/data_view \
  -H 'kbn-xsrf: true' \
  -H 'Content-Type: application/json' \
  -d '{"data_view":{"title":"l2-incident-lab-*","name":"L2 Incident Lab Logs","timeFieldName":"timestamp","allowNoIndex":true}}' \
  || true

