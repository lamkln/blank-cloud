#!/usr/bin/env bash
# Back-compat entrypoint — canonical URL is repo-root install.sh on branch main.
exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/lamkln/blank-cloud/main/install.sh)"
