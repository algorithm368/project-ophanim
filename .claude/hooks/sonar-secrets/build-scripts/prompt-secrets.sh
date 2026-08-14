#!/bin/bash
# Secret scanning on prompt submit. Same reasoning as pretool-secrets.sh: skip
# quietly when the CLI is missing or not logged in rather than blocking.
command -v sonar &> /dev/null || exit 0
sonar auth status &> /dev/null || exit 0
sonar hook claude-prompt-submit
