#!/bin/sh
# Function bundles can't reach outside their own directory, so _shared is
# copied into each function that imports it before deploy. The canonical
# source stays in functions/_shared — edit there, never in the copies.
set -e
cd "$(dirname "$0")"
for dir in spaceOps promoteMessage rightOfWayDoor voiceDeal askStream; do
  rm -rf "$dir/_shared"
  cp -R _shared "$dir/_shared"
done
echo "synced _shared into: spaceOps promoteMessage rightOfWayDoor voiceDeal askStream"
