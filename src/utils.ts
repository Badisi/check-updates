import { styleText } from 'node:util';
import packageJson from 'package-json';
import semverLt from 'semver/functions/lt';
import semverValid from 'semver/functions/valid';
import semverMinVersion from 'semver/ranges/min-version';

type Color = Parameters<typeof styleText>[0];

export const getPackageHomePage = async (name: string): Promise<string | undefined> => {
    try {
        const pkgData = await packageJson(name, { fullMetadata: true, allVersions: true });
        const pkgDataLatest = pkgData.versions[pkgData['dist-tags'].latest] as { homepage?: string; bugs?: { url: string }; repository?: { url: string } };
        return pkgDataLatest.homepage ?? pkgDataLatest.bugs?.url ?? pkgDataLatest.repository?.url;
    } catch {
        return undefined;
    }
};

const parseOperatorAndVersion = (str: string): { operator: string; version: string } => {
    const match = /^([<>=~^]+)?(.*)$/.exec(str.trim());
    return {
        operator: match?.[1] ?? '',
        version: match?.[2] ?? '',
    };
};

export const colorizeDiff = (from: string, to: string): string => {
    const fromParsed = parseOperatorAndVersion(from);
    const toParsed = parseOperatorAndVersion(to);

    const fromParts = fromParsed.version.split('.');
    const toParts = toParsed.version.split('.');

    // Check if the constraint operator itself changed
    const opChanged = fromParsed.operator !== toParsed.operator;

    // Find the first index where the version numbers diverge
    const diffIndex = fromParts.findIndex((part, i) => part !== toParts[i]);

    // If absolutely nothing changed, return the target string uniformly in gray
    if (!opChanged && diffIndex === -1) {
        return styleText('gray', to);
    }

    // 1. Determine the Color Theme for the version change
    let diffColor: Color = 'magenta';
    if (toParts[0] !== '0') {
        switch (diffIndex) {
            case 0: diffColor = 'red'; break; // Major version shift
            case 1: diffColor = 'cyan'; break; // Minor version shift
            case 2: diffColor = 'green'; break; // Patch version shift
            default: diffColor = 'red'; // Operator-only change fallback
        }
    }

    // 2. Handle Operator Colorization
    let styledOperator = toParsed.operator;
    if (opChanged) {
        // An operator modification changes constraint logic, always treat as major
        const opColor = toParts[0] === '0' ? 'magenta' : 'red';
        styledOperator = styleText(opColor, toParsed.operator);
    }

    // 3. Handle Version Component Colorization
    let versionString = toParsed.version;
    if (diffIndex !== -1) {
        const start = toParts.slice(0, diffIndex).join('.');
        const mid = diffIndex === 0 ? '' : '.';
        const end = styleText(diffColor, toParts.slice(diffIndex).join('.'));
        versionString = `${start}${mid}${end}`;
    }

    return `${styledOperator}${versionString}`;
};

export const updateSemverRange = (currentRange: string, targetVersion: string): string => {
    const trimmed = currentRange.trim();
    if (!semverValid(targetVersion)) { return currentRange; }

    // 1. Split Compound Logical OR Pipes (||) first
    if (trimmed.includes('||')) {
        const segments = trimmed.split(/\s*\|\|\s*/);
        segments[segments.length - 1] = updateSemverRange(segments[segments.length - 1], targetVersion);
        return segments.join(' || ');
    }

    // 2. Split Compound Hyphen Ranges (e.g., 1.0.0 - 2.0.0)
    if (trimmed.includes(' - ')) {
        const parts = trimmed.split(/\s+-\s+/);
        if (parts.length === 2 && parts[1]) {
            // Safely update only the right-hand boundary element in place
            parts[1] = updateSemverRange(parts[1], targetVersion);
            return parts.join(' - ');
        }
    }

    // 3. Safeguard validation with graceful try/catch fallback for completely invalid ranges
    const isPureUpperBound = /^\s*<[^=]|=\s*</.test(trimmed);
    if (!isPureUpperBound) {
        try {
            const minimum = semverMinVersion(trimmed);
            if (minimum && semverLt(targetVersion, minimum.version)) {
                return currentRange;
            }
        } catch {
            // If the initial range string is completely un-parseable, allow the targetVersion fallback
            return targetVersion;
        }
    }

    // 4. Structural Rule: Global Wildcards
    if (trimmed === '*' || trimmed === 'x' || trimmed === 'X') {
        return currentRange;
    }

    // 5. Structural Rule: Convert Upper Bounds (< or <=) to Caret ranges
    if (/^\s*<(=?)/.test(trimmed)) {
        return `^${targetVersion}`;
    }

    const [tMajor, tMinor, tPatch] = targetVersion.split('.');

    // 6. Structural Rule: Partial X-Ranges / Asterisk Wildcards (e.g., 1.x, 1.2.*)
    if (/x|X|\*/.test(trimmed)) {
        // Only replace explicitly numerical segments, skipping actual x/X/* layout tokens
        return trimmed
            .replace(/^(\d+)/, tMajor)
            .replace(/\.(\d+)(?=\.|$)/, `.${tMinor}`)
            .replace(/\.(\d+)$/, `.${tPatch}`);
    }

    // 7. Structural Rule: Standard Operators (>=, >, ^, ~, etc.)
    const prefixMatch = /^([>=~^]+)/.exec(trimmed);
    if (prefixMatch) {
        const operator = prefixMatch[0];
        return `${operator}${targetVersion}`;
    }

    // Default Fallback
    return targetVersion;
};
