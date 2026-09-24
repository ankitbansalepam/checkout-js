const conventionalRecommendedBump = require('conventional-recommended-bump');
const semver = require('semver');
const argv = require('yargs').argv;
const { execSync } = require('child_process');

const packageJson = require('../../package.json');

let nextVersion;

// Check if git is available
function isGitAvailable() {
    try {
        execSync('git --version', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function getNextVersion() {
    if (!nextVersion) {
        nextVersion = new Promise((resolve, reject) => {
            if (argv.releaseAs) {
                return resolve(semver.clean(argv.releaseAs));
            }

            // If git is not available (e.g., in Vercel), use package.json version
            if (!isGitAvailable()) {
                console.warn('Git not available, using package.json version');
                return resolve(packageJson.version);
            }

            conventionalRecommendedBump({ preset: 'angular' }, (err, release) => {
                const prerelease = process.env.PRERELEASE;

                if (err) {
                    // Fallback to package.json version if git fails
                    console.warn('conventional-recommended-bump failed, using package.json version:', err.message);
                    return resolve(packageJson.version);
                }

                if (prerelease) {
                    const prereleaseType = typeof prerelease === 'string' ? prerelease : 'alpha';

                    return resolve(semver.inc(packageJson.version, 'prerelease', prereleaseType).replace(/\.\d+$/, `.${Date.now()}`));
                }

                resolve(semver.inc(packageJson.version, release.releaseType));
            })
        });
    }

    return nextVersion;
}

module.exports = getNextVersion;
