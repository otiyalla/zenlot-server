#!/bin/bash
# Create a new migration
#sudo chown -R $(whoami) prisma/migrations
echo "Enter the name of the migration: "
read migrationName
echo "Running: yarn prisma migrate dev --name $migrationName"
sudo chown -R $(whoami) prisma/migrations
yarn prisma migrate dev --name $migrationName
