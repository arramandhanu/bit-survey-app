#!/bin/bash
# ============================================
# Docker Hub Push Script
# dev  = git commit SHA tag
# prod = latest tag
# ============================================

set -e

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-aryaramandhanu}"
IMAGE_NAME="${IMAGE_NAME:-bit-survey-app}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-.}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get environment from argument
ENV="${1:-dev}"

# Full image name
FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}"

# Get git commit SHA
GIT_SHA=$(git rev-parse --short HEAD)
GIT_SHA_FULL=$(git rev-parse HEAD)

# Set tag based on environment
if [ "$ENV" = "prod" ]; then
    TAG="latest"
    echo -e "${YELLOW}Environment: PRODUCTION${NC}"
else
    TAG="${GIT_SHA}"
    echo -e "${YELLOW}Environment: DEVELOPMENT${NC}"
fi

echo -e "${YELLOW}================================================${NC}"
echo -e "${YELLOW}  Docker Hub Push Script${NC}"
echo -e "${YELLOW}================================================${NC}"
echo ""
echo -e "Image:      ${GREEN}${FULL_IMAGE}:${TAG}${NC}"
echo -e "Git SHA:    ${GREEN}${GIT_SHA}${NC}"
echo -e "Full SHA:   ${GIT_SHA_FULL}"
echo ""

# Check if logged in to Docker Hub
if ! docker info 2>/dev/null | grep -q "Username"; then
    echo -e "${RED}Error: Not logged in to Docker Hub${NC}"
    echo "Please run: docker login"
    exit 1
fi

# Build the image
echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t "${FULL_IMAGE}:${TAG}" "${DOCKERFILE_PATH}"

echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Push to Docker Hub
echo -e "${YELLOW}Pushing to Docker Hub...${NC}"
echo "Pushing ${FULL_IMAGE}:${TAG}"
docker push "${FULL_IMAGE}:${TAG}"

echo -e "${GREEN}✓ Push complete${NC}"
echo ""

# Update docker-compose.yml with the new image tag
echo -e "${YELLOW}Updating ${COMPOSE_FILE}...${NC}"

if [ -f "${COMPOSE_FILE}" ]; then
    # Use sed to replace the image line
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS requires empty string after -i
        sed -i '' "s|image: ${FULL_IMAGE}:.*|image: ${FULL_IMAGE}:${TAG}|g" "${COMPOSE_FILE}"
    else
        # Linux
        sed -i "s|image: ${FULL_IMAGE}:.*|image: ${FULL_IMAGE}:${TAG}|g" "${COMPOSE_FILE}"
    fi
    echo -e "${GREEN}✓ Updated ${COMPOSE_FILE} to use ${FULL_IMAGE}:${TAG}${NC}"
else
    echo -e "${RED}Warning: ${COMPOSE_FILE} not found, skipping update${NC}"
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "Image available at:"
echo -e "  ${GREEN}${FULL_IMAGE}:${TAG}${NC}"
echo ""
echo -e "Pull command:"
echo -e "  docker pull ${FULL_IMAGE}:${TAG}"
echo ""
echo -e "Deploy command:"
echo -e "  docker compose pull && docker compose up -d"
