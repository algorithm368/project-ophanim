#!/bin/bash
# Secret scanning on every Read. It is a safety net, not a gate, so a machine
# without the CLI or without a login lets the tool call through instead of
# failing it.
#
# The auth guard is the important one. `sonar hook` exits non-zero when there is
# no saved connection, and a non-zero PreToolUse hook blocks the tool, so
# without this line an unauthenticated machine cannot read a file at all.
# `sonar auth status` is a local credential check, not a network round trip
# (~0.2s), which is why it is affordable per Read.
command -v sonar &> /dev/null || exit 0
sonar auth status &> /dev/null || exit 0
sonar hook claude-pre-tool-use
