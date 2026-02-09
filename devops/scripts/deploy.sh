#!/bin/bash
set -e

BRANCH="develop-test"

echo "Starting deployment for branch: $BRANCH"

# Ensure correct branch
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

# Build and deploy
echo "Building Docker images..."
docker compose build

echo "Starting containers..."
docker compose up -d

echo "Deployment completed successfully for $BRANCH"

