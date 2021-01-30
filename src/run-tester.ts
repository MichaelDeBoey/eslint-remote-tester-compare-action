import fs from 'fs';
import path from 'path';
import { exec } from '@actions/exec';
import {
    Config,
    ConfigToValidate,
} from 'eslint-remote-tester/dist/exports-for-compare-action';
import {
    requirePeerDependency,
    ESLINT_REMOTE_TESTER_BIN,
} from './peer-dependencies';

const INTERNAL_CONFIG = 'eslint-remote-tester-compare-internal.config.js';
export const COMPARISON_RESULTS_TMP = '/tmp/comparison-results.json';

/**
 * Configuration values used internally. These are overwritten from user provided configuration
 */
const DEFAULT_CONFIG_REQUIRED: ConfigToValidate = {
    CI: true,
    compare: true,
    updateComparisonReference: true,
    cache: false,
};

/**
 * Configuration values used if user has not provided these
 */
const DEFAULT_CONFIG_OPTIONAL: ConfigToValidate = {
    resultParser: 'markdown',
};

// prettier-ignore
const CONFIGURATION_TEMPLATE = (
    configuration: Config,
    configurationPath: string,
    onCompleteFromComment?: Config['onComplete']
) =>
 `// Generated by eslint-remote-tester-compare-action
const fs = require('fs');

module.exports = {
    ...${JSON.stringify(configuration, null, 4)},
    onComplete: async function onCompare(results, comparisonResults) {
        fs.writeFileSync('${COMPARISON_RESULTS_TMP}', JSON.stringify(comparisonResults || {}));

        // User provided onComplete is injected here if present
        // Argument from comment overrides user-provided configuration
        ${onCompleteFromComment
            ? `await (${onCompleteFromComment.toString()})(results, comparisonResults)`
            : configuration.onComplete
            ? `await require('${configurationPath}').onComplete(results, comparisonResults);`
            : '// No onComplete detected'
        }
    }
};
`;

/**
 * Runs `eslint-remote-tester` using given `configLocation` as base configuration.
 * Some fields are overwritten by internal config.
 *
 * **Note** that this same method is used for comparison reference generation
 * and the actual comparison run.
 */
export default async function runTester(
    configLocation: string,
    configurationFromComment: Partial<Config>
): Promise<void> {
    const usersConfigLocation = path.resolve(configLocation);

    if (!fs.existsSync(ESLINT_REMOTE_TESTER_BIN)) {
        throw new Error(
            `Missing eslint-remote-tester. Expected it to be available at ${path.resolve(
                ESLINT_REMOTE_TESTER_BIN
            )}`
        );
    }
    if (!fs.existsSync(usersConfigLocation)) {
        throw new Error(
            `Unable to find eslint-remote-tester config with path ${usersConfigLocation}`
        );
    }

    // Try-catch required by esbuild
    let userProvidedConfig;
    // eslint-disable-next-line no-useless-catch
    try {
        userProvidedConfig = require(usersConfigLocation);
    } catch (e) {
        throw e;
    }

    const config = mergeConfigurations(
        {
            ...DEFAULT_CONFIG_OPTIONAL,
            ...userProvidedConfig,
            ...DEFAULT_CONFIG_REQUIRED,
        },
        configurationFromComment
    );

    // Write eslint-remote-tester configuration file
    fs.writeFileSync(
        INTERNAL_CONFIG,
        CONFIGURATION_TEMPLATE(
            config,
            usersConfigLocation,
            configurationFromComment.onComplete
        )
    );

    await exec(`cat ./${INTERNAL_CONFIG}`);

    // Validate configuration before run
    const { validateConfig } = requirePeerDependency('eslint-remote-tester');
    await validateConfig(config, false);

    // Run eslint-remote-tester with generated configuration
    await exec(
        `${ESLINT_REMOTE_TESTER_BIN} --config ./${INTERNAL_CONFIG}`,
        [],
        { ignoreReturnCode: true }
    );
}

/**
 * Add configuration from comment into eslint-remote-tester configuration
 */
function mergeConfigurations(
    config: Config,
    configurationFromComment: Partial<Config>
): Config {
    return {
        ...config,
        ...configurationFromComment,
        eslintrc: {
            ...config.eslintrc,
            ...configurationFromComment.eslintrc,
        },
    };
}