/* eslint-disable */
const fs = require('fs');
const path = require('path');

const packageJsonPath = path.resolve(__dirname, 'package.json');
const packageJson = require(packageJsonPath);

// Get the build SHA (replace with CI/CD env variable or git command)
const buildSHA =
    process.env.BUILD_SHA ||
    require('child_process')
        .execSync('git rev-parse --short HEAD')
        .toString()
        .trim();

// Extract the original version and check if the SHA is already appended
const baseVersion = packageJson.version.split('-')[0]; // Remove any existing suffix
const currentSuffix = packageJson.version.split('-')[-1]; // Current suffix (if any)

// Skip updating if the same SHA is already present
if (currentSuffix === buildSHA) {
    console.log(
        `Version is already updated to include the current build SHA (${buildSHA}). No changes made.`,
    );
    process.exit(0);
}

// Append the build SHA as a pre-release suffix
const newVersion = `${baseVersion}-alpha-${buildSHA}`;
packageJson.version = newVersion;

// Write the updated version back to package.json
fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2),
    'utf-8',
);

console.log(`Updated version to ${newVersion}`);

// Run build and publish commands
const { execSync } = require('child_process');

try {
    console.log('Building package...');
    execSync('npm run build', { stdio: 'inherit' });

    console.log('Publishing package...');
    execSync('npm publish', { stdio: 'inherit' });

    console.log('Successfully built and published package');
} catch (error) {
    console.error('Failed to build or publish package:', error);
    process.exit(1);
}
