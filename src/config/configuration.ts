import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const ENVIRONMENT = process.env.NODE_ENV || 'development';

export default () => {
  try {
    // Try multiple possible paths to find the config file
    const possiblePaths = [
      // Path for production (compiled)
      join(__dirname, 'environments', `${ENVIRONMENT}.json`),
      // Path for development
      join(__dirname, '..', 'config', 'environments', `${ENVIRONMENT}.json`),
      // Absolute path from project root
      resolve(
        process.cwd(),
        'src',
        'config',
        'environments',
        `${ENVIRONMENT}.json`,
      ),
      // Path for when running from dist
      resolve(
        process.cwd(),
        'dist',
        'config',
        'environments',
        `${ENVIRONMENT}.json`,
      ),
    ];

    let configFile;
    let usedPath;

    // Try each path until we find one that works
    for (const path of possiblePaths) {
      try {
        configFile = readFileSync(path, 'utf8');
        usedPath = path;
        break;
      } catch (e) {
        // Continue to the next path
      }
    }

    if (!configFile) {
      throw new Error(
        `Could not find config file for environment ${ENVIRONMENT}. Tried paths: ${possiblePaths.join(', ')}`,
      );
    }

    console.log(`Loaded configuration from ${usedPath}`);
    const config = JSON.parse(configFile);

    // Merge with environment variables if needed
    // For example, you can override database password from environment variable:
    if (process.env.DB_PASSWORD) {
      config.database.password = process.env.DB_PASSWORD;
    }

    return config;
  } catch (error) {
    console.error(
      `Error loading configuration for environment ${ENVIRONMENT}:`,
      error,
    );
    throw error;
  }
};
