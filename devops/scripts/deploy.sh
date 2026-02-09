#!/bin/bash
set -e

BRANCH="deploy/test-1"

echo "Starting deployment for branch: $BRANCH"

# Ensure on correct branch and update code
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

echo "Building Docker images..."
docker compose build

echo "Starting containers..."
docker compose up -d

echo "Deployment completed successfully"

